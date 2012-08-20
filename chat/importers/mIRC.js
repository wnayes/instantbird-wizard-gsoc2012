/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsImporterHelper.jsm");
Cu.import("resource:///modules/jsProtoHelper.jsm");
Cu.import("resource:///modules/imServices.jsm");

XPCOMUtils.defineLazyGetter(this, "_", function()
  l10nHelper("chrome://chat/locale/irc.properties")
);

/* The importer below contains methods to retrieve the current IRC account from
 * the Windows IRC client mIRC.
 *
 * Homepage: http://www.mirc.com/
 * Resources:
 *   A reference to the "mirc.ini" file format.
 *     http://www.mirc-support.de/help/mircini/
 *
 * Currently supports:
 *   - A findAccounts() implementation reading the user and host IRC information
 *     along with supported preferences.
 *   - An importData() implementation parsing the mIRC logs for the currently
 *     configured account.
 */
function mIRCImporter() { }
mIRCImporter.prototype = {
  __proto__: GenericImporterPrototype,
  get name() "mIRC",
  get id() "importer-mirc",

  findAccounts: function(aObserver) {
    this._observer = aObserver;

    let mircConfig = this._getMircConfiguration();
    if (!mircConfig.exists()) {
      this._endAccountSearch();
      return;
    }

    let mircIniFile = this._createINIFile(mircConfig);
    let user = this._getINIValue(mircIniFile, "mirc", "nick");
    let server = this._getINIValue(mircIniFile, "mirc", "host");

    // An IRC account cannot be created without both name and server.
    if (!user || !server) {
      this._endAccountSearch();
      return;
    }

    // Parse the unusual server string format.
    let serverInfo = this._parseServerString(server);

    // If this occurs, there must be an error with either the INI
    // or the parse method.
    if (!serverInfo.host) {
      let e = "importer-mirc: Error parsing server string \"" + server + "\"";
      Cu.reportError(e);
      this._endAccountSearch();
      return;
    }

    let name = user + "@" + serverInfo.host;
    let foundAccount = new ExistingAccount(name, "prpl-irc", this.id);

    if (serverInfo.port)
      foundAccount.setInt("port", serverInfo.port);

    let quitmsg = this._getINIValue(mircIniFile, "text", "quit");
    if (quitmsg)
      foundAccount.setString("quitmsg", quitmsg);

    let optList = this._getINIValue(mircIniFile, "options", "n0");
    if (optList)
      foundAccount.autoLogin = (optList[0] == "1");

    this._returnAccount(foundAccount);
    this._endAccountSearch();
  },

  importData: function(aAccount, aPreference, aObserver) {
    this._observer = aObserver;

    let pref = JSON.parse(aPreference);
    if (!pref.initialized) {
      let updatedPref = JSON.stringify(this._initImport(pref));
      this._updateImportStatus(aAccount, updatedPref);
      return;
    }

    if (!pref.fileInProgress) {
      // If we have finished a file previously and there are no more remaining,
      // the import is finished!
      if (!pref.logFiles.length) {
        this._updateImportStatus(aAccount, null);
        return;
      }

      pref.fileInProgress = pref.logFiles[0];
      pref.filePosition = 0x00;
      pref.logFiles = pref.logFiles.slice(1);
    }

    let logFile = Cc["@mozilla.org/file/local;1"]
                    .createInstance(Ci.nsILocalFile);
    logFile.initWithPath(pref.fileInProgress);

    // Create a stream to read lines from the log files from the last offset.
    let logStream = Cc["@mozilla.org/network/file-input-stream;1"]
                      .createInstance(Ci.nsIFileInputStream);
    logStream.init(logFile, 0x1, 0, 0);
    logStream.QueryInterface(Ci.nsISeekableStream);
    logStream.seek(0, pref.filePosition);
    logStream.QueryInterface(Ci.nsILineInputStream);

    let messageRegex = /(.*)\s?<[%@\+]?(.*)>\s(.*)/;
    let joinRegex = /(.*)\s?\*\s[%@\+]?(.*)\s\((.*)\)\shas\sjoined/;
    let partRegex = /(.*)\s?\*\s[@%\+]?(.*)\s\((.*)\)\shas\sleft/;
    let partReasonRegex = /(.*)\s?\*\s[@%\+]?(.*)\s\((.*)\)\shas\sleft\s.+\s\("(.*)".?\)/;
    let quitRegex = /(.*)\s?\*\s(.*)\s\((.*)\)\sQuit\s\((.*)\x0F\)/;
    let modeRegex = /(.*)\s?\*\s(.*)\ssets mode:\s(.*)\s(.*)/;
    let modeChannelRegex = /(.*)\s?\*\s(.*)\ssets mode:\s(.*)/;
    let kickRegex = /(.*)\s?\*\s(.*)\swas kicked by\s(.*)/;
    let kickReasonRegex = /(.*)\s?\*\s(.*)\swas kicked by\s(.*)\s\((.*)\x0F\)/;
    let systemRegex = /(.*)\s?\*\s(.*)/;

    let dateRegex;
    if (pref.timestampsEnabled)
      dateRegex = new RegExp(pref.timestampRegex.regex);

    let conversation, sessionDate, target;
    let [line, more] = [{}, false];
    do {
      more = logStream.readLine(line);
      let val = line.value;

      // Update the current offset with the string length. The stream offset is
      // not useful as it tells the buffer offset, not the single line offset.
      pref.filePosition += (line.value.length + 2);

      // Check if a new IRC session is starting.
      if (val.indexOf("Session Start") === 0) {
        // This would only occur with a malformed log file. Move to the next
        // file as if EOF reached.
        if (conversation) {
          Cu.reportError("mIRC log malformed (conversation already opened) in "
                         + pref.fileInProgress + " (Line: " + val);
          break;
        }

        // Parse the conversation session date for now.
        sessionDate = this._parseLogSessionDate(val);
        continue;
      }

      // Read the target name and create the conversation.
      if (val.indexOf("Session Ident") === 0) {
        target = val.slice(val.indexOf(":") + 2);
        let isChat = (target.indexOf("#") !== -1);
        conversation = new ImporterConversation(target, aAccount, isChat);
        Services.logs.logConversation(conversation, sessionDate.getTime());
        continue;
      }

      // Conversation has come to an end.
      if (val.indexOf("Session Close") === 0) {
        // This would only occur with a malformed log file. Move to the next
        // file as if EOF reached.
        if (!conversation) {
          Cu.reportError("mIRC log malformed (conversation not active) in "
                         + pref.fileInProgress + " (Line: " + val);
          break;
        }
        // Close the conversation in the logger and move on to the next one.
        conversation.unInit();
        logStream.close();
        this._updateImportStatus(aAccount, JSON.stringify(pref));
        return;
      }

      // Do not test for messages if there has not been a conversation opened.
      if (!conversation)
        continue;

      // Remove unnecessary characters found at the start of some lines.
      // Specifically, ASCII code 0x03 followed by either "02" or "03".
      if (val.indexOf("\x03") === 0)
        val = val.slice(3);

      let date, who, text;
      let msgObject = {};

      // Parse the different possible messages in the conversation.
      let match;
      if ((match = val.match(messageRegex)) && match) {
        [date, who, text] = match.slice(1);
        msgObject.outgoing = (who == pref.nick || who == pref.anick);
        msgObject.incoming = !msgObject.outgoing;
      }
      else if ((match = val.match(joinRegex)) && match) {
        [date, who] = match.slice(1);
        text = _("message.join", who, match[3]);
        msgObject.system = true;
        msgObject.noLinkification = true;
      }
      else if ((match = val.match(partReasonRegex)) && match) {
        [date,, who] = match.slice(1);
        text = _("message.parted", match[2], _("message.parted.reason", match[4]));
        msgObject.system = true;
      }
      else if ((match = val.match(partRegex)) && match) {
        [date,, who] = match.slice(1);
        text = _("message.parted", match[2]);
        msgObject.system = true;
      }
      else if ((match = val.match(quitRegex)) && match) {
        [date, who] = [match[1], null];
        text = _("message.quit", match[2], _("message.quit2", match[4]));
        msgObject.system = true;
      }
      else if ((match = val.match(modeRegex)) && match) {
        [date, who] = match.slice(1);
        text = _("message.mode", match[4], match[3], who);
        msgObject.system = true;
      }
      else if ((match = val.match(modeChannelRegex)) && match) {
        [date, who] = match.slice(1);
        text = _("message.mode", target, match[3], who);
        msgObject.system = true;
      }
      else if ((match = val.match(kickReasonRegex)) && match) {
        [date,, who] = match.slice(1);
        text = _("message.kicked", match[2], who, _("message.kicked.reason", match[4]));
        msgObject.system = true;
      }
      else if ((match = val.match(kickRegex)) && match) {
        [date,, who] = match.slice(1);
        text = _("message.kicked", match[2], who);
        msgObject.system = true;
      }
      else if ((match = val.match(systemRegex)) && match) {
        [date, who, text] = [match[1], null, match[2]];
        msgObject.system = true;
      }

      if (pref.timestampsEnabled) {
        let msgDate = this._parseMessageDate(date, sessionDate, dateRegex,
                                             pref.timestampRegex.order);
        msgObject.time = (msgDate / 1000);
      }

      if (text)
        conversation.writeMessage(who, text, msgObject);
      else
        dump("\nUnknown message type in mIRC log file. Message: " + val);
    } while (more);

    // The EOF has been reached, prepare the pref for the next file to parse.
    logStream.close();
    delete pref.fileInProgress;
    this._updateImportStatus(aAccount, JSON.stringify(pref));
  },

  _initImport: function(aPref) {
    let mircConfig = this._getMircConfiguration();
    if (!mircConfig.exists()) {
      Cu.reportError("Could not read mIRC configuration file (mirc.ini)");
      return null;
    }
    let mircIniFile = this._createINIFile(mircConfig);

    aPref.logDirectory = this._getLogDirectory(mircIniFile);
    if (!aPref.logDirectory) {
      Cu.reportError("Could not locate mIRC log directory");
      return null;
    }

    let server = this._getINIValue(mircIniFile, "mirc", "host");
    server = this._parseServerString(server);
    if (!server.group) {
      Cu.reportError("Could not read group name of account");
      return null;
    }
    aPref.serverGroup = server.group.toLowerCase();

    aPref.nick = this._getINIValue(mircIniFile, "mirc", "nick");
    aPref.anick = this._getINIValue(mircIniFile, "mirc", "anick");

    aPref.timestampsEnabled =
      (this._getINIValue(mircIniFile, "options", "n6").split(",")[26] === "1");
    if (aPref.timestampsEnabled) {
      let timestamp = this._getINIValue(mircIniFile, "text", "logstamp");
      aPref.timestampRegex = this._createTimestampRegex(timestamp);
    }

    // Locate the log files to be imported. Being that the account imported
    // was of a certain server group, only logs of that group will be saved.
    let mircLogDir = Cc["@mozilla.org/file/local;1"]
                       .createInstance(Ci.nsILocalFile);
    mircLogDir.initWithPath(aPref.logDirectory);
    let logFiles = mircLogDir.directoryEntries;
    aPref.logFiles = [];
    while (logFiles.hasMoreElements()) {
      let logFile = logFiles.getNext().QueryInterface(Ci.nsIFile);
      // The server group should be in the filename, but not at the beginning.
      if (logFile.path.toLowerCase().indexOf(aPref.serverGroup) <= 0)
        continue;
      // The status.[group].log file is not wanted.
      let statusName = "status." + aPref.serverGroup;
      if (logFile.leafName.toLowerCase().indexOf(statusName) === 0)
        continue;
      aPref.logFiles.push(logFile.path);
    }

    aPref.initialized = true;
    return aPref;
  },

  // The "logdir" value holds the directory where mIRC stores log files.
  // The value may either be a relative directory or a full path.
  _getLogDirectory: function(aMircConfIni) {
    let logdir = this._getINIValue(aMircConfIni, "dirs", "logdir");
    if (logdir.indexOf(":") === -1) {
      let mircLogDir = this._getMircConfiguration().parent;
      mircLogDir.appendRelativePath(logdir);
      if (!mircLogDir.exists())
        return null;
      return mircLogDir.path;
    }
    return logdir;
  },

  // mIRC writes the date when a channel is entered and left in the logs. This
  // parses that string and returns a Date object (to the nearest second).
  _parseLogSessionDate: function(aString) {
    let dateString = aString.replace("Session Start: ", "")
                            .replace("Session Close: ", "");
    return new Date(dateString);
  },

  _parseMessageDate: function(aDatestring, aSessionDate, aRegex, aOrder) {
    let msgDate = new Date(aSessionDate.getFullYear(), aSessionDate.getMonth(),
                           aSessionDate.getDate());
    if (!aDatestring || !aRegex)
      return msgDate;

    let dateMatch = aDatestring.match(aRegex);
    if (dateMatch) {
      let matches = dateMatch.slice(1);

      let longMonths =  ["January", "February", "March", "April", "May", "June",
                         "July", "August", "September", "October", "November",
                         "December"];
      let shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      let longDays =    ["Monday", "Tuesday", "Wednesday", "Thursday",
                         "Friday", "Saturday", "Sunday"];
      let shortDays =   ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      for (let i = 0; i < matches.length; ++i) {
        let type = aOrder[i];
        if (type === "year")
          msgDate.setFullYear(parseInt(matches[i]));
        else if (type === "month") {
          if (longMonths.indexOf(matches[i]) !== -1)
            msgDate.setMonth(longMonths.indexOf(matches[i]));
          else if (shortMonths.indexOf(matches[i]) !== -1)
            msgDate.setMonth(shortMonths.indexOf(matches[i]));
          else
            msgDate.setMonth(parseInt(matches[i]));
        }
        else if (type === "day" && !isNaN(parseInt(matches[i])))
            msgDate.setDate(parseInt(matches[i]));
        else if (type === "hour")
          msgDate.setHours(parseInt(matches[i]));
        else if (type === "minute")
          msgDate.setMinutes(parseInt(matches[i]));
        else if (type === "second")
          msgDate.setSeconds(parseInt(matches[i]));
      }
    }
    return msgDate;
  },

  // The user can specify a custom timestamp in mIRC's options. This will be
  // parsed by creating a regular expression based on that timestamp mask.
  _createTimestampRegex: function(aTimestamp) {
    // Escape special characters of a regular expression.
    let timestamp = aTimestamp.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    let regex = "";
    let matchOrder = [];

    const dateItems = [
      { masks: ["yyyy", "yy"],             desc: "year" },
      { masks: ["mmmm", "mmm", "mm", "m"], desc: "month" },
      { masks: ["dddd", "ddd", "dd", "d"], desc: "day" },
      { masks: ["HH", "H", "hh", "h"],     desc: "hour" },
      { masks: ["nn", "n"],                desc: "minute" },
      { masks: ["ss", "s"],                desc: "second" },
      { masks: [],                         desc: "milliseconds" },
      { masks: ["TT", "T", "tt", "t"],     desc: "am/pm" },
      { masks: ["oo"],                     desc: "ordinal" },
      { masks: ["zzz", "zz", "z"],         desc: "timezone" }
    ];
    const monthStringRegex = "(January|February|March|April|May|June|July|" +
                             "August|September|October|November|December)";
    const dayStringRegex = "(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";

    // Advance through the timestamp, checking for the date indicators.
    let i = 0;
    while (i < timestamp.length) {
      let found = false;
      for (let j = 0; j < dateItems.length; ++j) {
        let itemTypes = dateItems[j].masks;
        for each (let indicator in itemTypes) {
          if (timestamp.indexOf(indicator, i) === i) {
            found = true;
            switch (j) {
              case 0:
              case 3:
              case 4:
              case 5:
                regex += "(\\d{" + indicator.length + "})";
                break;
              case 1:
                if (indicator.length === 4)
                  regex += monthStringRegex;
                else if (indicator.length === 3)
                  regex += "([A-Z][a-z]{2})";
                else
                  regex += "(\\d{" + indicator.length + "})";
                break;
              case 2:
                if (indicator.length === 4)
                  regex += dayStringRegex;
                else if (indicator.length === 3)
                  regex += "([A-Z][a-z]{2})";
                else
                  regex += "(\\d{" + indicator.length + "})";
                break;
              case 7:
                if (indicator.length === 1)
                  regex += "([AaPp])";
                else
                  regex += "([AaPm][Mm])";
              case 8:
                regex += "(st|nd|rd|th)";
                break;
              case 9:
                regex += "([-\\+]\\d{" + (indicator.length > 1 ? "4})" : "1})");
                regex += (indicator.length > 2 ? "\\sGMT" : "");
                break;
            }
            i += (indicator.length - 1);
            matchOrder.push(dateItems[j].desc);
            break;
          }
        }
      }
      // The character at index 0 is a literal in the timestamp.
      if (!found)
        regex += timestamp[i];
      i++;
    }
    return {regex: regex, order: matchOrder};
  },

  // A typical server entry might look as such:
  // [mirc]
  // host=Random serverSERVER:irc.dal.net:6667GROUP:DALnet
  _parseServerString: function(aString) {
    // This regex matches the server host, port, and group of the server string.
    let serverRegExp = /SERVER:([\w\.]+):?(\d*)?(?:GROUP:)?(\w*)?/
    let result = serverRegExp.exec(aString).slice(1);

    // Create an object to return the IRC host, port, and group.
    let serverObj = {host: '', port: '', group: ''};
    serverObj.host = result[0];
    if (result.length > 1)
      serverObj.port = parseInt(result[1]);
    if (result.length > 2)
      serverObj.group = result[2];
    return serverObj;
  },

  // mIRC stores application settings in a "mIRC" directory found in the
  // Windows user's AppData directory.
  _getMircDirectory: function() {
    let mircFolder = Services.dirsvc.get("AppData", Ci.nsIFile);
    mircFolder.append("mIRC");
    return mircFolder.clone();
  },

  // mIRC stores IRC account information in a "mirc.ini" found in the mIRC
  // AppData directory.
  _getMircConfiguration: function() {
    let mircConfig = this._getMircDirectory();
    mircConfig.append("mirc.ini");
    return mircConfig.clone();
  },

  _createINIFile: function(aFile) {
    let iniFactory = Components.manager.getClassObjectByContractID(
                       "@mozilla.org/xpcom/ini-parser-factory;1",
                       Ci.nsIINIParserFactory);
    return iniFactory.createINIParser(aFile);
  },

  _getINIValue: function(aINIParser, aSection, aProperty) {
    try {
      return aINIParser.getString(aSection, aProperty);
    } catch(e) {
      return undefined;
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImporter]),
  classID: Components.ID("{f9d5e613-b320-461c-8c03-faa89afdb68c}")
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([mIRCImporter]);
