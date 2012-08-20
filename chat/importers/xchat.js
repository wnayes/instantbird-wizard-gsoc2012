/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsImporterHelper.jsm");
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

const kLineBreak = "@mozilla.org/windows-registry-key;1" in Cc ? "\r\n" : "\n";

/* The importer below contains methods to retrieve the
 * IRC accounts from the XChat IRC client.
 *
 * Homepage: http://xchat.org/
 * Resources:
 *   Official XChat FAQ
 *     http://xchat.org/faq/#q222
 *   Details about XChat's profile directory.
 *     http://xchatdata.net/Using/ProfileDirectory
 *
 * Currently supports:
 *   - A findAccounts() implementation reading the user and server
 *     IRC information along with supported preferences.
 */
function xchatImporter() { }
xchatImporter.prototype = {
  __proto__: GenericImporterPrototype,
  get name() "XChat",
  get id() "importer-xchat",

  findAccounts: function(aObserver) {
    this._observer = aObserver;

    this._xchatConfig = this._getXChatConfiguration();
    if (!this._xchatConfig.exists()) {
      this._endAccountSearch();
      return;
    }

    let xchatServerList = this._getXChatDirectory();
    xchatServerList.append("servlist_.conf");
    if (!xchatServerList.exists()) {
      this._endAccountSearch();
      return;
    }

    // Both the XChat configuration file and server list must be read
    // asynchronously before parsing.
    NetUtil.asyncFetch(xchatServerList, function(stream, status) {
      if (!Components.isSuccessCode(status)) {
        this._endAccountSearch();
        return;
      }
      this._serverList = NetUtil.readInputStreamToString(stream, stream.available());

      NetUtil.asyncFetch(this._xchatConfig, function(stream, status) {
        if (!Components.isSuccessCode(status)) {
          this._endAccountSearch();
          return;
        }
        let config = NetUtil.readInputStreamToString(stream, stream.available());
        this._parseXChatConfig(config, this._serverList);
      }.bind(this));
    }.bind(this));
  },

  // This method handles the parsing of the XChat configuration file
  // into ExistingAccount objects.
  _parseXChatConfig: function(aConfig, aServlist) {
    let settings = {
      name: '',
      server: {host: '', port: ''},
      partmsg: '',
      quitmsg: ''
    };
    let entries = aConfig.split("\n");

    for each (entry in entries) {
      entry = entry.split(" = ");
      switch (entry[0]) {
        case "irc_nick1":
          settings.name = entry[1];
          break;
        case "gui_slist_select":
          let serverIndex = parseInt(entry[1]);
          let curServer = this._getXChatServer(serverIndex, aServlist);
          if (curServer) {
            if (curServer.indexOf("/")) {
              curServer = curServer.split("/");
              settings.server.host = curServer[0];
              settings.server.port = parseInt(curServer[1]);
            }
            else
              settings.server.host = curServer;
          }
          break;
        case "irc_part_reason":
          settings.partmsg = entry[1];
          break;
        case "irc_quit_reason":
          settings.quitmsg = entry[1];
          break;
      }
    }

    if (!settings.name || !settings.server.host) {
      this._endAccountSearch();
      return;
    }

    let name = settings.name + "@" + settings.server.host;
    let foundAccount = new ExistingAccount(name, "prpl-irc", this.id);

    if (settings.server.port)
      foundAccount.setInt("port", settings.server.port);
    if (settings.quitmsg)
      foundAccount.setString("quitmsg", settings.quitmsg);
    if (settings.partmsg)
      foundAccount.setString("partmsg", settings.partmsg);

    this._returnAccount(foundAccount);
    this._endAccountSearch();
  },

  /* While an "xchat.conf" file stores the selected server index,
     a "servlist_.conf" file lists these servers. This method parses
     this long list of servers to retrieve the specific one that
     the user was last using.

     A typical servlist_.conf starts as follows:

       v=2.8.9

       N=Aservername
       E=IRC (Latin/Unicode Hybrid)
       F=19
       D=0
       S=irc.aserver.net

       N=Bserver name
       E=IRC (Latin/Unicode Hybrid)
       F=19
       D=0
       S=irc.bserver.net

    There are several more entries in the default servlist_.conf, which
    follow the above pattern. This method parses this format by splitting
    by double newlines (\n\n) to get each server section, then splitting
    by the single newline (\n) to get each sections individual name=value
    pairs. The target key is "S=", which will give the server url. */
  _getXChatServer: function(aServerIndex, aServerList) {
    if (!aServerList)
      return undefined;

    let serverConfigs = aServerList.split(kLineBreak + kLineBreak);
    if (serverConfigs.length < aServerIndex) {
      Cu.reportError("_getXChatServer: aServerIndex out of bounds.");
      return undefined;
    }

    // The index is incremented by 1 to offset the "v=#.#.#" entry (see above).
    let selectedConfig = serverConfigs[aServerIndex + 1].split("\n");
    for each (let entry in selectedConfig) {
      entry = entry.split("=");
      if (entry[0] == "S")
        return entry[1];
    }
    return undefined;
  },

  // On Windows machines, the XChat directory is "X-Chat 2" in AppData,
  // while in Linux the directory is ".xchat2". Both OS have the same
  // files present despite this.
  _getXChatDirectory: function() {
    let xchatDir;
    if (Services.appinfo.OS != "WINNT") {
      xchatDir = Services.dirsvc.get("Home", Ci.nsIFile);
      xchatDir.append(".xchat2");
    } else {
      xchatDir = Services.dirsvc.get("AppData", Ci.nsIFile);
      xchatDir.append("X-Chat 2");
    }
    return xchatDir;
  },

  // This is a shortcut method to grab the "xchat.conf" nsIFile, which
  // stores several "name=value" pairs.
  _getXChatConfiguration: function() {
    let xchatConfig = this._getXChatDirectory().clone();
    xchatConfig.append("xchat.conf");
    return xchatConfig;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImporter]),
  classID: Components.ID("{9043aa53-d133-4ca9-a5ce-01dc22ee5159}")
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([xchatImporter]);
