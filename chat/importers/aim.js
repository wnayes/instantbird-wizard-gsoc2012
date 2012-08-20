/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsImporterHelper.jsm");
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource:///modules/blowfish.jsm");

/* The importer below contains methods to retrieve configured
 * AIM 6.x accounts.
 *
 * Homepage: http://www.aim.com/
 * Resources:
 *   A summary of the AIM Blowfish key generation.
 *     http://insecurety.net/?p=112
 *
 * Currently supports:
 *   - A findAccounts() implementation which can locate AIM usernames and
 *     passwords from the Windows registry.
 */
function aim6Importer() { }
aim6Importer.prototype = {
  __proto__: GenericImporterPrototype,
  get name() "AIM 6.x",
  get id() "importer-aim6x",

  findAccounts: function(aObserver) {
    this._observer = aObserver;

    // AIM 6.x stores user account information in the Windows registry:
    // HKU\Software\America Online\AIM6\Passwords
    const ACCESS_READ = Ci.nsIWindowsRegKey.ACCESS_READ;
    let swKey = Cc["@mozilla.org/windows-registry-key;1"]
                  .createInstance(Ci.nsIWindowsRegKey);
    swKey.open(swKey.ROOT_KEY_CURRENT_USER, "Software", ACCESS_READ);
    if (!swKey.hasChild("America Online")) {
      this._endAccountSearch();
      return;
    }
    let aolKey = swKey.openChild("America Online", ACCESS_READ);
    if (!aolKey.hasChild("AIM6")) {
      this._endAccountSearch();
      return;
    }
    let aimKey = aolKey.openChild("AIM6", ACCESS_READ);
    if (!aimKey.hasChild("Passwords")) {
      this._endAccountSearch();
      return;
    }
    let passwordsKey = aimKey.openChild("Passwords", ACCESS_READ);

    // Within the Passwords key, each value represents an account. The name of
    // each value is an AIM username, and the string value is the user's
    // encrypted password base64 encoded.
    for (let i = 0; i < passwordsKey.valueCount; ++i) {
      let username = passwordsKey.getValueName(i);
      let foundAccount = new ExistingAccount(username, "prpl-aim", this.id);

      // Decode and decrypt the user's password.
      let encodedPass = passwordsKey.readStringValue(username);
      let decodedPass = atob(encodedPass);
      foundAccount.password = this.decryptPassword(decodedPass);

      this._returnAccount(foundAccount);
    }

    // Close the handles on the Windows registry.
    passwordsKey.close();
    aimKey.close();
    aolKey.close();
    swKey.close();
    this._endAccountSearch();
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImporter]),
  classID: Components.ID("{2aa7b114-6937-4eab-bb5e-f4ff874a2a77}")
};
aim6Importer.prototype.decryptPassword = decryptPassword;

/* The importer below contains methods to retrieve configured
 * AIM 7.x accounts.
 *
 * Homepage: http://www.aim.com/
 *
 * Currently supports:
 *   - A findAccounts() implementation reading the username and password of a
 *     saved AIM 7.x account.
 */
function aim7Importer() { }
aim7Importer.prototype = {
  __proto__: GenericImporterPrototype,
  get name() "AIM 7.x",
  get id() "importer-aim7x",

  findAccounts: function(aObserver) {
    this._observer = aObserver;

    let aimxfile = this._getAIMXFile();
    if (!aimxfile.exists()) {
      this._endAccountSearch();
      return;
    }

    // Asynchronously read the aimx.bin file into a stream and run it through a
    // parsing function.
    NetUtil.asyncFetch(aimxfile, this._parseAIMXFile.bind(this));
  },

  _parseAIMXFile: function(stream, status) {
    if (!Components.isSuccessCode(status)) {
      this._endAccountSearch();
      return;
    }

    // A StreamListener implementation is needed to receive the asynchronously
    // decompressed string.
    let myListener = new StreamListener();

    // The aimx.bin file is compressed with DEFLATE. The asynchronous method
    // of nsIStreamConverter must be used as the synchronous is not implemented.
    let converter = Cc["@mozilla.org/streamconv;1?from=deflate&to=uncompressed"]
                      .createInstance(Ci.nsIStreamConverter);
    converter.asyncConvertData("deflate", "uncompressed", myListener, null);
    converter.onStartRequest(null, null);
    converter.onDataAvailable(null, null, stream, 0, stream.available());
    converter.onStopRequest(null, null, 201);

    // The result of the uncompression is a string containing an AIM username
    // and Base64 encoded password separated by '-'.
    let decompressed = myListener.data;
    let userData = decompressed.split("-");

    // Catch any invalid data
    if (userData.length !== 2 || !userData[0] || !userData[1]) {
      this._endAccountSearch();
      return;
    }

    let [username, encodedPass] = userData;
    let foundAccount= new ExistingAccount(username, "prpl-aim", this.id);

    // Base64 decode the password string and Blowfish decrypt the blocks.
    let encodedPass = encodedPass.slice(0, encodedPass.length - 3);
    let decodedPass = atob(encodedPass);
    foundAccount.password = this.decryptPassword(decodedPass);

    this._returnAccount(foundAccount);
    this._endAccountSearch();
  },

  // AIM 7.x stores the saved login information in an "aimx.bin" file found in
  // the user's AppData/Local directory. This file has been gzip compressed, but
  // without the full gzip heading. Once uncompressed, this file contains a
  // username and base64 encoded encrypted password. The encryption is the same
  // that AIM 6.x uses.
  _getAIMXFile: function() {
    let aimxFile = Services.dirsvc.get("LocalAppData", Ci.nsIFile);
    aimxFile.append("AIM");
    aimxFile.append("aimx.bin");
    return aimxFile.clone();
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIImporter]),
  classID: Components.ID("{0eb885e8-1fa2-4761-ada1-8a44ee339ec4}")
};
aim7Importer.prototype.decryptPassword = decryptPassword;

// AIM6 and AIM7 use the same Blowfish encryption techniques.
// This method handles calls to the Blowfish cipher module, and returns the
// user's plaintext password. It is called with the encrypted password text.
function decryptPassword(aPassword) {
  // Read the individual character codes from the encrypted password string.
  let passArray = [aPassword.charCodeAt(i) for (i in aPassword)];

  // The first 8 bytes of the encrypted password string are a "salt". To
  // create the Blowfish key, this salt is prepended to a known static key,
  // creating a 448-bit key, the maximum allowed by a Blowfish implementation.
  let salt = passArray.slice(0, 8);
  let key =
    salt.concat([0x99, 0x00, 0x86, 0xA5, 0x27, 0xAA, 0x9D, 0x7F, 0x58, 0xAA,
                 0xAE, 0xB9, 0x0B, 0x47, 0x3A, 0x35, 0xAA, 0xE0, 0xEA, 0x95,
                 0x66, 0xFB, 0xE4, 0x9F, 0xCB, 0xF7, 0x16, 0x1C, 0xA3, 0x92,
                 0xE6, 0x1C, 0x96, 0x06, 0x9B, 0x5B, 0x29, 0x30, 0xBF, 0xAF,
                 0xEC, 0x11, 0x29, 0xC8, 0x89, 0x5B, 0xB8, 0x57]);
  key = Uint8Array(key);

  // TODO: Use of DataView in Mozilla 15 should eliminate this function.
  let _swapEndianness = function(aWord) {
    return ((aWord & 0xFF) << 24) | ((aWord & 0xFF00) << 8)
           | ((aWord >> 8) & 0xFF00) | ((aWord >> 24) & 0xFF);
  };

  // The remainder of the encrypted password string after the salt is the
  // password itself.
  let pass = Uint32Array(Uint8Array(passArray.slice(8)).buffer);
  for (let i = 0; i < pass.length; ++i)
    pass[i] = _swapEndianness(pass[i]);
  pass = Uint8Array(pass.buffer);

  // The Blowfish cipher takes and outputs Uint8Array values.
  let blowfish = new Blowfish(key);
  let output = blowfish.decrypt(pass);

  output = Uint32Array(output.buffer);
  for (let i = 0; i < output.length; ++i)
    output[i] = _swapEndianness(output[i]);

  // Convert the typed array of Unicode bytes into a string.
  pass = String.fromCharCode.apply(null, new Uint16Array(output.buffer));

  // Remove any low ASCII values, trailing 0x00s can occur and cause errors.
  return pass.split("").filter(function(e) e.charCodeAt(0) >= 0x20).join("");
};

// StreamListener implementation for AIM 7.x file decompression.
function StreamListener() {
  this.data = "";
}
StreamListener.prototype = {
  onStartRequest: function(aReq, aContext) { },
  onStopRequest: function(aReq, aContext, aStatusCode) { },
  onDataAvailable: function(aReq, aContext, aInputStream, aOffset, aCount) {
    let binInputStream = Cc["@mozilla.org/binaryinputstream;1"]
                           .createInstance(Ci.nsIBinaryInputStream);
    binInputStream.setInputStream(aInputStream);
    let input = binInputStream.readByteArray(aCount);

    // Filter out lower ASCII values that can result after uncompression.
    input = input.filter(function(e) e >= 0x20);
    this.data += String.fromCharCode.apply(String, input);
    binInputStream.close();
  }
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([aim6Importer,
                                                      aim7Importer]);
