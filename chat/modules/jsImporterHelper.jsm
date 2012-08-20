/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This file contains an implementation of imIExistingAccount, as well as
// an imIImporter prototype for sharing prototype code between the importers.
// ImporterConversation is an implementation of prplIConversation that does not
// create UI events.

const EXPORTED_SYMBOLS = [
  "ExistingAccount",
  "GenericImporterPrototype",
  "ImporterConversation"
];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsProtoHelper.jsm");
Cu.import("resource:///modules/imServices.jsm");

initLogModule("jsImporterHelper", this);

function ExistingAccount(aName, aProtocolId, aImporterId) {
  this._name = aName;
  this._protoId = aProtocolId;
  this._importerId = aImporterId;
  this._options = [];
}
ExistingAccount.prototype = {
  __proto__: ClassInfo("imIExistingAccount", "existing account generic object"),

  get name() this._name,
  get protocolId() this._protoId,
  get importerId() this._importerId,

  autoLogin: false,
  dateModified: 0,
  password: "",
  alias: "",

  getOptions: function() {
    if (!this._options)
      return EmptyEnumerator;
    return new nsSimpleEnumerator(this._options);
  },
  setBool: function(aName, aVal) {
    this._setOption(aName, aVal, Ci.prplIPref.typeBool, "getBool");
  },
  setInt: function(aName, aVal) {
    this._setOption(aName, aVal, Ci.prplIPref.typeInt, "getInt");
  },
  setString: function(aName, aVal) {
    if (this._setOption(aName, aVal, Ci.prplIPref.typeString, "getString"))
      return;
    this._setOption(aName, aVal, Ci.prplIPref.typeList, "getListDefault");
  },
  _setOption: function(aName, aVal, aType, aGetMethod) {
    let protoId = this._protoId;
    let protoOptions = Services.core.getProtocolById(protoId).getOptions();
    while (protoOptions.hasMoreElements()) {
      let opt = protoOptions.getNext().QueryInterface(Ci.prplIPref);
      if (opt.type == aType && opt.name == aName) {
        // Create a new preference with the new value (in 'default' property)
        let newOpt = new purplePref(aName, {label: opt.label, default: aVal});

        // Avoid keeping track of a default preference.
        if (opt[aGetMethod]() != newOpt[aGetMethod]()) {
          this._options.push(newOpt);
          return true;
        }
        return false;
      }
    }
  }
};

const GenericImporterPrototype = {
  __proto__: ClassInfo("imIImporter", "generic importer object"),

  // The XPCShell tests access the importer JS Object.
  get wrappedJSObject() this,

  // Methods defined in the imIImporter interface.
  findAccounts: function(aObserver) {
    this._observer = aObserver;
    this._endAccountSearch();
  },
  importData: function(aAccount, aPreference, aObserver) {
    this._observer = aObserver;
    this._updateImportStatus(aAccount, null);
  },

  // Helper methods for observer notifications.
  _returnAccount: function(aExistingAccount) {
    this._observer.observe(aExistingAccount, "existing-account-found", null);
  },
  _endAccountSearch: function() {
    this._observer.observe(this, "account-search-finished", null);
  },
  _updateImportStatus: function(aAccount, aPreference) {
    this._observer.observe(aAccount, "import-status-updated", aPreference);
  }
};

function ImporterConversation(aName, aAccount, aIsChat, aBuddy) {
  this._name = aName;
  this._account = aAccount;
  this._isChat = aIsChat;
  this.buddy = aBuddy;
  this._observers = [];
  // TODO: Method of assigning ID outside of ConversationService?
  this._id = Math.random() * 9999;
}
ImporterConversation.prototype = {
  __proto__: ClassInfo("prplIConversation", "importer conversation object"),

  get account() this._account,
  get name() this._name,
  get normalizedName() this._name,
  get title() this._name,
  get id() this._id,
  get isChat() this._isChat,

  addObserver: function(aObserver) {
    if (this._observers.indexOf(aObserver) === -1)
      this._observers.push(aObserver);
  },
  removeObserver: function(aObserver) {
    this._observers = this._observers.filter(function(o) o !== aObserver);
  },
  notifyObservers: function(aSubject, aTopic, aData) {
    for each (let observer in this._observers)
      observer.observe(aSubject, aTopic, aData);
  },

  close: function() {},
  unInit: function() {
    delete this._account;
    delete this._observers;
    this.notifyObservers(this, "conversation-closed", null);
  },
  writeMessage: function(aWho, aText, aProperties) {
    (new Message(aWho, aText, aProperties)).conversation = this;
  }
};
