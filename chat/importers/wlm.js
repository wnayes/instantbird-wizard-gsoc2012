/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsImporterHelper.jsm");
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource:///modules/winCredentialStore.jsm");

/* The importer below contains methods to retrieve configured
 * Windows Live Messenger accounts.
 *
 * Homepage: http://windows.microsoft.com/en-US/windows-live/essentials-home
 *
 * Currently supports:
 *   - A findAccounts() implementation obtaining Windows Live Messenger
 *     username and passwords from the Windows Credential Store.
 */
function windowsLiveMessengerImporter() { }
windowsLiveMessengerImporter.prototype = {
  __proto__: GenericImporterPrototype,
  get name() "Windows Live Messenger",
  get id() "importer-wlm",

  findAccounts: function(aObserver) {
    this._observer = aObserver;

    // WLM stores user passwords in the Windows Credential Store.
    let credStore = new CredentialStore();

    // Filter the credentials found with the WLM prefix.
    let credentials = credStore.getCredentials("WindowsLive:name=*");
    for each (let cred in credentials) {
      // Each credential from the filtered search is an MSN account.
      let foundAccount = new ExistingAccount(cred.username, "prpl-msn", this.id);

      // The Credential Blob stores the plaintext WLM password.
      if (cred.credentialBlob)
        foundAccount.password = cred.credentialBlob;
      this._returnAccount(foundAccount);
    }

    // Properly close the DLL library access by js-ctypes.
    credStore.shutdown();
    this._endAccountSearch();
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImporter]),
  classID: Components.ID("{03cc0f7e-f208-4183-8150-769f979bee24}")
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([windowsLiveMessengerImporter]);
