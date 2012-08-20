/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsImporterHelper.jsm");
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

// The PropertyListUtils object allows access to OS X property list files,
// handling the details of parsing the various formats in existance.
XPCOMUtils.defineLazyModuleGetter(this, "PropertyListUtils",
                                  "resource://gre/modules/PropertyListUtils.jsm");

/* The importer below contains methods to retrieve configured Colloquy IRC
 * accounts.
 *
 * Homepage: http://colloquy.info/
 *
 * Currently supports:
 *   - A findAccounts() implementation reading the available IRC accounts from
 *     the Colloquy configuration property list.
 */
function colloquyImporter() { }
colloquyImporter.prototype = {
  __proto__: GenericImporterPrototype,
  get name() "Colloquy",
  get id() "importer-colloquy",

  findAccounts: function(aObserver) {
    this._observer = aObserver;

    let propFile = this._getColloquyConfiguration();
    if (!propFile.exists()) {
      this._endAccountSearch();
      return;
    }

    // Asynchronously read the info.colloquy.plist file and run it through a
    // parsing function.
    PropertyListUtils.read(propFile, this._parseColloquyProperties.bind(this));
    return;
  },

  _parseColloquyProperties: function(aPropertiesRoot) {
    // The properties file was not properly parsed.
    if (!aPropertiesRoot) {
      this._endAccountSearch();
      Cu.reportError("Could not read Colloquy property list");
      return;
    }

    // The properties list does not have a MVChatBookmarks entry
    if (!aPropertiesRoot.has("MVChatBookmarks")) {
      this._endAccountSearch();
      return;
    }

    let accounts = aPropertiesRoot.get("MVChatBookmarks");
    for each (let account in accounts) {
      // Colloquy website says there is IRC, SILC, and ICB support.
      // TODO: Are XMPP settings supported?
      if (!account.has("type"))
        continue;
      let type;
      switch(account.get("type")) {
        case "irc":
          type = "prpl-irc";
          break;
        default:
          continue;
      }

      // Read the username and server keys from the account dictionary.
      let username, server;
      if (account.has("username"))
        username = account.get("username");
      if (account.has("server"))
        server = account.get("server");

      if (!username || !server)
        continue;

      let accountName = username + "@" + server;
      let foundAccount = new ExistingAccount(accountName, type, this.id);

      if (account.has("port")) {
        let port = parseInt(account.get("port"));
        foundAccount.setInt("port", port);
      }

      if (account.has("secure")) {
        let ssl = account.get("secure");
        foundAccount.setBool("ssl", !!ssl);
      }

      this._returnAccount(foundAccount);
    }

    this._endAccountSearch();
  },

  // Colloquy stores a property list of settings in
  // ~/Library/Preferences/info.colloquy.plist
  _getColloquyConfiguration: function() {
    let colloquyInfo = Services.dirsvc.get("Home", Ci.nsIFile);
    colloquyInfo.append("Library");
    colloquyInfo.append("Preferences");
    colloquyInfo.append("info.colloquy.plist");
    return colloquyInfo;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImporter]),
  classID: Components.ID("{d89d3c75-bb22-4a1b-9078-19361b5e2b8a}")
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([colloquyImporter]);
