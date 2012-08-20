/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsImporterHelper.jsm");
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource://gre/modules/ctypes.jsm");

/* The importer below contains methods to retrieve configured
 * Google Talk client accounts.
 *
 * Homepage: http://www.google.com/talk/
 * Resources:
 *   A good summary of the password generation algorithm.
 *     http://insecurety.net/?p=137
 *
 * Currently supports:
 *   - A findAccounts() implementation locating the username and password of
 *     the currently saved GTalk credentials.
 */
function googleTalkImporter() { }
googleTalkImporter.prototype = {
  __proto__: GenericImporterPrototype,
  get name() "Google Talk",
  get id() "importer-googletalk",

  findAccounts: function(aObserver) {
    this._observer = aObserver;

    const ACCESS_READ = Ci.nsIWindowsRegKey.ACCESS_READ;
    let swKey = Cc["@mozilla.org/windows-registry-key;1"]
                  .createInstance(Ci.nsIWindowsRegKey);
    swKey.open(swKey.ROOT_KEY_CURRENT_USER, "Software", ACCESS_READ);
    if (!swKey.hasChild("Google")) {
      this._endAccountSearch();
      return;
    }
    let googleKey = swKey.openChild("Google", ACCESS_READ);
    if (!googleKey.hasChild("Google Talk")) {
      this._endAccountSearch();
      return;
    }
    let gtalkKey = googleKey.openChild("Google Talk", ACCESS_READ);
    if (!gtalkKey.hasChild("Accounts")) {
      this._endAccountSearch();
      return;
    }
    let accountsKey = gtalkKey.openChild("Accounts", ACCESS_READ);

    for (let i = 0; i < accountsKey.childCount; ++i) {
      let username = accountsKey.getChildName(i);
      let foundAccount = new ExistingAccount(username, "prpl-gtalk", this.id);

      let child = accountsKey.openChild(username, ACCESS_READ);
      if (child.hasValue("pw")) {
        foundAccount.password = this._decryptPass(child.readStringValue("pw"));
        // If the 'pw' value exists, the account is set to auto-login
        foundAccount.autoLogin = true;
      }
      this._returnAccount(foundAccount);
    }

    accountsKey.close();
    gtalkKey.close();
    googleKey.close();
    swKey.close();
    this._endAccountSearch();
  },

  // The first step towards decrypting (or encrypting) a Google Talk saved
  // password is to create the entropy data, 16 bytes that are unique based on
  // the user's username and domain.
  _initializeEntropy: function() {
    // These values are read from environment variables.
    const username = this._getCurrentUser();
    const domain = this._getCurrentDomain();

    // The entropy and seed start out with certain values.
    let entropy = Uint32Array([0x69F31EA3, 0x1FD96207, 0x7D35E91E, 0x487DD24F]);
    let seed = 0xBA0DA71D;
    // TODO: (Gecko 15) Consider using DataView to avoid 32-bit math issues.

    // Establish the multiplier for modifying the entropy and seed.
    const multiplier = 48271;
    // Create an array of the username and domain character code values.
    const combinedString = username + domain;
    const charCodes = [combinedString.charCodeAt(i) for (i in combinedString)];

    // Mix the character code values into the entropy.
    let index = 0;
    for each (let charcode in charCodes) {
      entropy[index++ % 4] ^= (charcode * seed);
      seed = (seed * multiplier) >>> 0;
    }

    // The entropy returned is an Uint32Array.
    return entropy;
  },

  // After the entropy has been created, the custom Base16 password string read
  // from the registry can be decoded into binary data.
  _decodePasswordString: function(aPassword, aEntropy) {
    // Google uses the following character alphabet in their Base16 encoding.
    const alphabet = "!\"#$%&'()*+,-./0";

    // A separate seed is initialized using the entropy.
    // TODO: (Gecko 15) Consider using DataView to avoid 32-bit math issues.
    let seed = aEntropy[0] | 1;
    const multiplier = 69621;

    // After the decoding below, the encrypted password will be half the length
    // of the original encoded string.
    let decodedPass = new Uint8Array(aPassword.length / 2);
    let passIndex = 0;
    for (let i = 4; i < aPassword.length; i += 2) {
      decodedPass[passIndex] = alphabet.indexOf(aPassword[i]) << 4;
      decodedPass[passIndex] |= alphabet.indexOf(aPassword[i + 1]) & 0x0F;
      decodedPass[passIndex++] -= (seed & 0xFF);
      seed = (seed * multiplier) >>> 0;
    }

    // The decoded password returned is an Uint8Array.
    return decodedPass;
  },

  _cryptUnprotectData: function(aDataIn, aDataEntropy) {
    let crypt32 = ctypes.open("Crypt32");

    // The DATA_BLOB struct contains an "arbitrary array of bytes."
    // http://msdn.microsoft.com/en-us/library/aa381414.aspx
    const DATA_BLOB = ctypes.StructType("DATA_BLOB", [
      {'cbData': ctypes.uint32_t},         // Data size (in bytes)
      {'pbData': ctypes.unsigned_char.ptr} // Pointer to data
    ]);

    let CryptUnprotectData = crypt32.declare("CryptUnprotectData",
      ctypes.winapi_abi,
      ctypes.bool,
      DATA_BLOB.ptr,      // *pDataIn
      ctypes.unsigned_char.ptr,  // null (description)
      DATA_BLOB.ptr,      // *pOptionalEntropy
      ctypes.voidptr_t,   // null
      ctypes.voidptr_t,   // null
      ctypes.uint32_t,    // dwFlags
      DATA_BLOB.ptr       // *pDataOut
    );

    // Create a DATA_BLOB of the input password entry.
    let inputArray = [aDataIn[i] for (i in aDataIn)];
    let dataInArray = ctypes.unsigned_char.array(inputArray.length)(inputArray);
    let dataInBlob = DATA_BLOB(dataInArray.length, dataInArray.addressOfElement(0));

    // Create a DATA_BLOB of the entropy data. The array of 32-bit entropy must
    // now be converted to a 16 byte 8-bit array.
    let dataEntropyArray = ctypes.unsigned_char.array(16)();
    let x = 0;
    for (let i = 0; i < aDataEntropy.length; i++) {
      for (let j = 0; j < 4; j++) {
        dataEntropyArray[x++] = ctypes.unsigned_char(aDataEntropy[i] & 255);
        if (j !== 3)
          aDataEntropy[i] = aDataEntropy[i] >> 8;
      }
    }
    let dataEntropyBlob = DATA_BLOB(dataEntropyArray.length,
                                    dataEntropyArray.addressOfElement(0));

    // Create a DATA_BLOB to be filled with the plaintext information.
    let dataOutBlob = DATA_BLOB();
    let result = CryptUnprotectData(dataInBlob.address(),
                                    null,
                                    dataEntropyBlob.address(),
                                    null,
                                    null,
                                    1,
                                    dataOutBlob.address());

    if (!result) {
      let e = "importer-googletalk CryptUnprotectData: " + ctypes.winLastError;
      Cu.reportError(e);
      return "";
    }

    let passArray = ctypes.cast(dataOutBlob.pbData,
                                ctypes.unsigned_char.array(dataOutBlob.cbData).ptr);
    let password = passArray.contents.readString();

    crypt32.close();

    // The memory handle to the dataOutBlob must be freed.
    let kernel32 = ctypes.open("Kernel32");
    let LocalFree = kernel32.declare("LocalFree",
      ctypes.winapi_abi,
      ctypes.voidptr_t,
      ctypes.voidptr_t
    );
    LocalFree(dataOutBlob.pbData);
    kernel32.close();

    return password;
  },

  // This method ties together the entropy creation, password decoding, and
  // decryption using CryptUnprotectData.
  _decryptPass: function(aPassword) {
    let entropy = this._initializeEntropy();
    let decodedPass = this._decodePasswordString(aPassword, entropy);
    return this._cryptUnprotectData(decodedPass, entropy);
  },

  _getCurrentUser: function() {
    let envService = Cc["@mozilla.org/process/environment;1"]
                       .getService(Ci.nsIEnvironment);
    return envService.get("USERNAME");
  },

  _getCurrentDomain: function() {
    let envService = Cc["@mozilla.org/process/environment;1"]
                       .getService(Ci.nsIEnvironment);
    return envService.get("USERDOMAIN");
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImporter]),
  classID: Components.ID("{24df4c97-6526-4938-9880-f88d9013910d}")
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([googleTalkImporter]);
