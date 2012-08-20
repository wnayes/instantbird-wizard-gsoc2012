/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This is a JavaScript implementation of the imIImportersService interface
// defined in chat/components/public.

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/imServices.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "categoryManager",
                                   "@mozilla.org/categorymanager;1",
                                   "nsICategoryManager");

const kImporterPluginCategory = "im-import-plugin";
const kImportIdleSeconds = 60;

function ImportersService() { }
ImportersService.prototype = {
  // Called when the core initializes. If data importing has not been completed,
  // it will be scheduled in the idleService.
  initImporters: function() {
    let enabled = Services.prefs.getBoolPref("messenger.importWizard.enabled");
    if (this._pendingImport() && enabled)
      this._monitorIdleness();
  },

  unInitImporters: function() {
    if (this._monitoringIdleness) {
      this._idleService.removeIdleObserver(this, kImportIdleSeconds);
      this._monitoringIdleness = false;
      this._idleService = null;
    }
  },

  _idle: false,
  _monitoringIdleness: false,
  _monitorIdleness: function() {
    if (this._monitoringIdleness)
      return;
    this._idleService = Cc["@mozilla.org/widget/idleservice;1"]
                          .getService(Ci.nsIIdleService);
    this._idleService.addIdleObserver(this, kImportIdleSeconds);
    this._monitoringIdleness = true;
  },

  // Determines whether there is data awaiting import.
  _pendingImport: function() {
    let accounts = Services.prefs.getCharPref("messenger.accounts").split(",");
    for each (let accountId in accounts) {
      let prefName = "messenger.account." + accountId + ".import";
      if (Services.prefs.prefHasUserValue(prefName))
        return true;
    }
    return false;
  },

  findAccounts: function(aObserver) {
    this._findAccObserver = aObserver;

    // Locate the registered importers and create instances.
    this._importers = [];
    let importers = this.getImporters();
    while (importers.hasMoreElements())
      this._importers.push(importers.getNext().QueryInterface(Ci.imIImporter));

    // If there are no importers registered, the observer still needs a signal.
    if (!this._importers.length) {
      this._findAccObserver.observe(this, "account-search-finished", null);
      return;
    }

    // Call the account search method on each importer. The use of executeSoon
    // is to prevent race conditions when calling observe() on the UI from the
    // importers.
    for each (let importer in this._importers) {
      try {
        let findAccounts = importer.findAccounts;
        executeSoon(function() {
          try {
            findAccounts(this);
          } catch(e) {
            Cu.reportError("Error in importer findAccounts(): " + e.message);
            this.observe(importer, "account-search-finished", null);
          }
        }.bind(this));
      }
      catch (e) {
        Cu.reportError("Error calling findAccounts(): " + e.message);
      }
    }
  },

  queueAccount: function(aAccountId, aImporterId) {
    let prefName = "messenger.account." + aAccountId + ".import";
    if (Services.prefs.prefHasUserValue(prefName)) {
      // Throw an error if the pref exists; maybe there is further action to
      // take here? The UI should not allow the user to add the same account
      // twice.
      let error = "Account " + aAccountId + " has an existing importer " +
                  "preference: " + Services.prefs.getCharPref(prefName);
      Cu.reportError(error);
      return;
    }

    // Write the initial import preference.
    let pref = JSON.stringify({account: aAccountId, importer: aImporterId});
    Services.prefs.setCharPref(prefName, pref);
  },

  observe: function(aSubject, aTopic, aData) {
    if (aTopic === "existing-account-found") {
      this._findAccObserver.observe(aSubject, "existing-account-found", null);
    }
    else if (aTopic === "account-search-finished") {
      let importerIndex = this._importers.indexOf(aSubject);
      if (importerIndex !== -1)
        this._importers.splice(importerIndex, 1);
      if (!this._importers.length)
        this._findAccObserver.observe(this, "account-search-finished", null);
    }
    else if (aTopic === "import-status-updated") {
      let [account, pref] = [aSubject, aData];
      let prefName = "messenger.account." + account.id + ".import";

      // The import is finished for this account.
      if (!pref) {
        Services.prefs.clearUserPref(prefName);
        return;
      }
      Services.prefs.setCharPref(prefName, pref);

      // The user has returned from idle, yet importing remains. The
      // next task will be postponed until idle occurs again.
      if (!this._idle)
        return;

      let importer = this.getImporterById(JSON.parse(pref).importer);
      let importData = importer.importData;
      executeSoon(function() {
        try {
          importData(account, pref, this);
        } catch(e) {
          Cu.reportError("Error in importer importData(): " + e.message);
        }
      }.bind(this));
    }
    else if (aTopic === "idle") {
      this._idle = true;

      // If we have received this notification and there is no pending import,
      // the idle observation can be removed; it would be added again if new
      // accounts were selected for import.
      if (!this._pendingImport()) {
        this.unInitImporters();
        return;
      }

      let accts = Services.prefs.getCharPref("messenger.accounts").split(",");
      for each (let accountId in accts) {
        // Check accounts for the pref indicating awaiting importable data.
        let prefName = "messenger.account." + accountId + ".import";
        if (!Services.prefs.prefHasUserValue(prefName))
          continue;

        let dataObj = Services.prefs.getCharPref(prefName);
        dataObj = JSON.parse(dataObj);

        // Distribute initial call to import the data. The service observer
        // will make future calls as necessary.
        let account = Services.accounts.getAccountById(accountId);
        let importer = this.getImporterById(dataObj.importer);
        let importData = importer.importData;
        executeSoon(function() {
          try {
            importData(account, JSON.stringify(dataObj), this);
          } catch(e) {
            Cu.reportError("Error in importer importData(): " + e.message);
          }
        }.bind(this));
      }
    }
    else if (aTopic === "back")
      this._idle = false;
  },

  getImporters: function() {
    let importers = [];
    let entries = categoryManager.enumerateCategory(kImporterPluginCategory);
    while (entries.hasMoreElements()) {
      let id = entries.getNext().QueryInterface(Ci.nsISupportsCString).data;
      let importer = this.getImporterById(id);
      if (importer)
        importers.push(importer);
    }
    return new nsSimpleEnumerator(importers);
  },

  getImporterById: function(aImporterId) {
    let cid;
    try {
      cid = categoryManager.getCategoryEntry(kImporterPluginCategory, aImporterId);
    } catch (e) {
      return null; // no importer registered for this id.
    }

    let importer = null;
    try {
      importer = Cc[cid].createInstance(Ci.imIImporter);
    } catch (e) {
      // This is a real error, the importer is registered and failed to init.
      let error = "failed to create an instance of " + cid + ": " + e;
      Cu.reportError(error);
    }
    if (!importer)
      return null;

    return importer;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImportersService]),
  classDescription: "Importers",
  classID: Components.ID("{d1f32c53-2272-4852-9564-4ab00f92b4dd}"),
  contractID: "@mozilla.org/chat/importers-service;1"
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([ImportersService]);
