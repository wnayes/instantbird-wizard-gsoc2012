/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsImporterHelper.jsm");
Cu.import("resource:///modules/jsProtoHelper.jsm");
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

/* The importer below contains methods to retrieve accounts
 * from the instant messaging client, Pidgin.
 *
 * Homepage: http://pidgin.im/
 * Resources:
 *   Summary of Pidgin's data storage.
 *     http://developer.pidgin.im/wiki/ConfigurationFiles
 *   An addon by waynenguyen implementing similar functionality.
 *     https://addons.instantbird.org/en-US/instantbird/addon/314
 *
 * Currently supports:
 *   - A findAccounts() implementation capable of parsing an accounts.xml
 *     document to locate accounts and their associated settings.
 *   - An importData() implementation parsing plaintext and HTML log files.
 */
function pidginImporter() { }
pidginImporter.prototype = {
  __proto__: GenericImporterPrototype,
  get name() "Pidgin",
  get id() "importer-pidgin",

  findAccounts: function(aObserver) {
    this._observer = aObserver;

    let accountFile = this._getPurpleDirectory();
    if (!accountFile.exists() || !accountFile.isDirectory()) {
      this._endAccountSearch();
      return;
    }
    accountFile.append("accounts.xml");
    if (!accountFile.exists()) {
      this._endAccountSearch();
      return;
    }

    // Asynchronously read the account.xml file into a stream and run it
    // through a parsing function.
    NetUtil.asyncFetch(accountFile, this._parseAccountXML.bind(this));
  },

  // This method is used by NetUtil.asyncFetch, and handles the parsing of the
  // accounts.xml file into ExistingAccount objects.
  _parseAccountXML: function(stream, status) {
    if (!Components.isSuccessCode(status)) {
      this._endAccountSearch();
      return;
    }

    let xmlParser = Cc["@mozilla.org/xmlextras/domparser;1"]
                      .createInstance(Ci.nsIDOMParser);
    let accountXml
      = xmlParser.parseFromStream(stream, null, stream.available(), "text/xml");
    let accounts = accountXml.documentElement.getElementsByTagName("account");
    for (let i = 0; i < accounts.length; ++i) {
      let account = accounts[i];

      let name = account.getElementsByTagName("name");
      if (name.length)
        name = name[0].textContent;

      let protocol = account.getElementsByTagName("protocol");
      if (protocol.length)
        protocol = protocol[0].textContent;

      // An account cannot be created if neither <name> or <protocol> tags do
      // not exist. Pidgin supports some prpl-ids not available in Instantbird.
      if ((!name || !protocol) || !Services.core.getProtocolById(protocol))
        continue;

      // Pidgin supports Facebook Chat/Google Talk, but uses an
      // XMPP account instead.
      if (protocol === "prpl-jabber") {
        let fbRegExp = /(\w+)(?=@chat.facebook.com\/)/;
        let gtalkRegExp = /(\w+)(?=@gmail.com|@googlemail.com)/;
        if (fbRegExp.test(name)) {
          name = name.match(fbRegExp)[0];
          protocol = "prpl-facebook";
        }
        else if (gtalkRegExp.test(name))
          protocol = "prpl-gtalk";
      }

      let foundAccount = new ExistingAccount(name, protocol, this.id);
      let password = account.getElementsByTagName("password");
      if (password.length)
        foundAccount.password = password[0].textContent;

      let alias = account.getElementsByTagName("alias");
      if (alias.length)
        foundAccount.alias = alias[0].textContent;

      let settings = account.getElementsByTagName("settings");
      this._parseSettings(settings, foundAccount);
      this._returnAccount(foundAccount);
    }
    this._endAccountSearch();
  },

  // Pidgin stores profile information with a ".purple" directory.
  // In Windows this directory can be found in the Roaming AppData
  // directory. In Linux/OS X, this directory is found in the user
  // home directory. For more information:
  // http://developer.pidgin.im/wiki/Using%20Pidgin#Whereismy.purpledirectory
  _getPurpleDirectory: function() {
    // Check for a PURPLEHOME environment variable, which
    // overrides the default location for the .purple directory.
    let envService = Cc["@mozilla.org/process/environment;1"]
                       .getService(Ci.nsIEnvironment);
    if (envService.exists("PURPLEHOME")) {
      let purpleOverride = envService.get("PURPLEHOME");
      let purpleDir = Cc["@mozilla.org/file/local;1"]
                        .createInstance(Ci.nsILocalFile);
      purpleDir.initWithPath(purpleOverride);
      purpleDir.append(".purple");
      return purpleDir.clone();
    }

    let systemDir = (Services.appinfo.OS === "WINNT" ? "AppData" : "Home");
    let purpleDir = Services.dirsvc.get(systemDir, Ci.nsIFile);
    purpleDir.append(".purple");
    return purpleDir.clone();
  },

  // Within an <account> tag, there are one or more <settings> tags.
  // Each of these tags has a varying number of <setting> tags, for example:
  //       <setting name='port' type='int'>5190</setting>
  // Most setting names correspond to Instantbird's namings due to
  // the use of libpurple - currently the ExistingAccounts handle
  // any incorrect setting names passed to the set*() methods.
  _parseSettings: function(aSettings, aExistingAccount) {
    for (let i = 0; i < aSettings.length; ++i) {
      let eachSetting = aSettings[i].getElementsByTagName("setting")
      for (let j = 0; j < eachSetting.length; ++j) {
        let setting = eachSetting[j];
        let type = setting.getAttribute("type");
        let name = setting.getAttribute("name");
        if (!setting.childNodes[0])
          continue;
        let value = setting.childNodes[0].nodeValue;

        // Filter out unused common preferences.
        let pidginSpecificSettings = [
          "check-mail", "use-global-buddyicon", "buddy_icon_timestamp"
        ];
        if (pidginSpecificSettings.indexOf(name) !== -1)
          continue;

        if (type === "bool") {
          if (name == "auto-login")
            aExistingAccount.autoLogin = (value == "1");
          else
            aExistingAccount.setBool(name, (value == "1"));
        }
        else if (type === "int")
          aExistingAccount.setInt(name, parseInt(value));
        else if (type === "string")
          aExistingAccount.setString(name, value);
      }
    }
  },

  importData: function(aAccount, aPreference, aObserver) {
    this._observer = aObserver;
    let pref = JSON.parse(aPreference);

    // If this is the initial call to start the import, files should be located.
    if (!pref.logFiles) {
      pref.logFiles = this._findAccountLogs(aAccount);
      this._updateImportStatus(aAccount, JSON.stringify(pref));
      return;
    }

    // The import is finished when no more files are pending.
    if (!pref.logFiles.length) {
      this._updateImportStatus(aAccount, null);
      return;
    }

    let logFile = Cc["@mozilla.org/file/local;1"]
                    .createInstance(Ci.nsILocalFile);
    logFile.initWithPath(pref.logFiles[0]);
    pref.logFiles = pref.logFiles.slice(1);

    // Create a stream to read lines from the log file.
    let logStream = Cc["@mozilla.org/network/file-input-stream;1"]
                      .createInstance(Ci.nsIFileInputStream);
    logStream.init(logFile, 0x1, 0, 0);
    logStream.QueryInterface(Ci.nsILineInputStream);

    let conversation, sessionDatestring, username;
    let [line, more] = [{}, false];
    do {
      more = logStream.readLine(line);
      let val = line.value;
      if (!val)
        continue;

      if (conversation) {
        // The log files are either HTML or TXT format. Separate parsing methods
        // are used, as the HTML formatting reveals more information.
        if (val[0] === "<")
          this._parseHTMLMessage(val, conversation, sessionDatestring);
        else
          this._parsePlaintextMessage(val, conversation, sessionDatestring, username);
        continue;
      }

      // Check for the conversation beginning header (in both HTML and TXT logs)
      let convHead = /with\s(.+?)\sat\s([\d\/:\s]+[AP]?M?)\son\s(.+?)\s\((.+?)\)/;
      let convMatches = val.match(convHead);
      if (convMatches) {
        let [target, date] = convMatches.slice(1);
        let isChat = (target.indexOf("#") === 0);

        // The username is preserved to determine incoming/outgoing messages.
        username = convMatches[3];
        if (username.indexOf("@") !== -1)
          username = username.slice(0, username.indexOf("@"));

        // TODO: Date may be either MM/DD/YYYY or DD/MM/YYYY and Date.parse
        // does not recognize this (but the importer can by checking for AM/PM)
        sessionDatestring = date.split(" ")[0];
        conversation = new ImporterConversation(target, aAccount, isChat);
        Services.logs.logConversation(conversation, new Date(date).getTime());
      }
    } while (more);

    // EOF has been reached, the next file will be read if available.
    logStream.close();
    this._updateImportStatus(aAccount, JSON.stringify(pref));
  },

  // Information from the tags can be used to determine additional information
  // on what type of message has been read.
  _parseHTMLMessage: function(aLine, aConversation, aSessionDatestring) {
    let msgObject = {};
    let who, text;

    let dateRegex = />\(([\d\/:\s]+[AP]?M?)\)<\/font>/;
    let matches = aLine.match(dateRegex);
    if (matches) {
      let msgDate = this._createMessageDate(matches[1], aSessionDatestring);
      msgObject.time = (msgDate / 1000);
    }

    let messageRegex = /<b>(.+):<\/b><\/font>\s(.+)<br\/>/;
    let systemRegex = /<b>\s(.+)<\/b><br\/>/;

    // Outgoing message usernames are colored #16569E, incoming are #A82F2F.
    if (aLine.indexOf("<font color=\"#16569E\">") === 0) {
      [who, text] = aLine.match(messageRegex).slice(1);
      msgObject.outgoing = true;
    }
    else if (aLine.indexOf("<font color=\"#A82F2F\">") === 0) {
      // Some incoming messages have a body tag enclosing them.
      let bodyRegex = /<b>(.+):<\/b><\/font>\s<body>(.+)<\/body><br\/>/;
      if (bodyRegex.test(aLine))
        [who, text] = aLine.match(bodyRegex).slice(1);
      else
        [who, text] = aLine.match(messageRegex).slice(1);
      msgObject.incoming = true;
    }
    else if (aLine.indexOf("<font size=\"2\">") === 0) {
      // This is a system message of some sort.
      if (systemRegex.test(aLine))
        text = aLine.match(systemRegex)[1];
      msgObject.system = true;
    }

    if (text)
      aConversation.writeMessage(who, text, msgObject);
    else
      dump("\nUnknown Pidgin log message: " + aLine);
    return;
  },

  _parsePlaintextMessage: function(aLine, aConversation, aSessionDatestring, aUser) {
    let msgObject = {};
    let who, text;

    let dateRegex = /^\(([\d\/:\s]+[AP]?M?)\)/;
    let matches = aLine.match(dateRegex);
    if (matches) {
      let msgDate = this._createMessageDate(matches[1], aSessionDatestring);
      msgObject.time = (msgDate / 1000);
    }

    // TODO: These are broad matching expressions to simply determine between
    // a regular message and a system message. A further step might be reading
    // the localizations of Pidgin and creating a regex from there.
    let messageRegex = /\)\s(\S+?):\s(.+)/;
    let systemRegex = /\)\s(.+)/;

    if (messageRegex.test(aLine)) {
      [who, text] = aLine.match(messageRegex).slice(1);
      msgObject.outgoing = (aUser === who);
      msgObject.incoming = !msgObject.outgoing;
    }
    else if (systemRegex.test(aLine)) {
      text = aLine.match(systemRegex)[1];
      msgObject.system = true;
    }

    if (text)
      aConversation.writeMessage(who, text, msgObject);
    else
      dump("\nUnknown Pidgin log message: " + aLine);
    return;
  },

  _createMessageDate: function(aDatestring, aSessionDatestring) {
    // TODO: Account for chats spanning more than one day?
    let fullDate = aSessionDatestring + " " + aDatestring;
    return (new Date(fullDate));
  },

  // The chat file/folder structure is nearly the same as the one used by the
  // chat/ logger. The log files are either HTML or TXT, not JSON.
  _findAccountLogs: function(aAccount) {
    let logDir = this._getPurpleDirectory();
    logDir.append("logs");
    if (!logDir.exists())
      return [];
    logDir.append(aAccount.protocol.normalizedName);
    if (!logDir.exists())
      return [];
    logDir.append(aAccount.normalizedName);
    if (!logDir.exists())
      return [];

    let foundLogFiles = [];
    // Each folder within this account's folder holds chats and conversations.
    let logFolders = logDir.directoryEntries;
    while (logFolders.hasMoreElements()) {
      let logFolder = logFolders.getNext().QueryInterface(Ci.nsIFile);
      // The .system folder has account status logs and should not be imported.
      if (logFolder.leafName == ".system")
        continue;
      let logFiles = logFolder.directoryEntries;
      while (logFiles.hasMoreElements()) {
        let logFile = logFiles.getNext().QueryInterface(Ci.nsIFile);
        foundLogFiles.push(logFile.path);
      }
    }
    return foundLogFiles;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImporter]),
  classID: Components.ID("{5063dfc7-1e04-42c1-be9f-8480f42ffd65}")
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([pidginImporter]);
