/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This is a JavaScript module providing access to the Windows Credential Store
// using js-ctypes and the WinAPI.

const EXPORTED_SYMBOLS = ["CredentialStore"];

Components.utils.import("resource:///modules/imXPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/ctypes.jsm");

const DWORD = ctypes.uint32_t;
const LPBYTE = ctypes.PointerType(ctypes.jschar);
const LPTSTR = ctypes.PointerType(ctypes.jschar);
const LPCTSTR = ctypes.PointerType(ctypes.jschar);
const PVOID = ctypes.PointerType(ctypes.void_t);

// "Contains a 64-bit value representing the number of 100-nanosecond intervals
// since January 1, 1601 (UTC)."
//  http://msdn.microsoft.com/en-us/library/ms724284.aspx
const FILETIME = ctypes.StructType("FILETIME", [
        {'dwLowDateTime': DWORD},
        {'dwHighDateTime': DWORD}
      ]);

// "The CREDENTIAL_ATTRIBUTE structure contains an application-defined attribute
// of the credential. An attribute is a keyword-value pair."
//  http://msdn.microsoft.com/en-us/library/aa374790.aspx
const CREDENTIAL_ATTRIBUTE = ctypes.StructType("CREDENTIAL_ATTRIBUTE", [
        {'Keyword': LPTSTR},
        {'Flags': DWORD},
        {'ValueSize': DWORD},
        {'Value': LPBYTE}
      ]);
const PCREDENTIAL_ATTRIBUTE = ctypes.PointerType(CREDENTIAL_ATTRIBUTE);

// "The CREDENTIAL structure contains a single credential."
//  http://msdn.microsoft.com/en-us/library/aa374788.aspx
const CREDENTIAL = ctypes.StructType("CREDENTIAL", [
        {'Flags': DWORD},
        {'Type': DWORD},
        {'TargetName': LPTSTR},
        {'Comment': LPTSTR},
        {'LastWritten': FILETIME},
        {'CredentialBlobSize': DWORD},
        {'CredentialBlob': LPBYTE},
        {'Persist': DWORD},
        {'AttributeCount': DWORD},
        {'Attributes': PCREDENTIAL_ATTRIBUTE},
        {'TargetAlias': LPTSTR},
        {'UserName': LPTSTR}
      ]);
const PCREDENTIAL = ctypes.PointerType(CREDENTIAL);
// PCREDENTIAL_ARRAY is not defined on MSDN, but there must be constant
// reference to the type for CredEnumerate to work.
const PCREDENTIAL_ARRAY = ctypes.ArrayType(PCREDENTIAL).ptr;

function CredentialStore() {
  this._credentialLib.init();
}
CredentialStore.prototype = {
  // The CredentialStore should be shutdown after use.
  shutdown: function() {
    this._credentialLib.shutdown();
  },

  // Returns an array of Credential objects.
  //  aFilter: A string to filter the returned credentials by TargetName.
  //           An asterisk can be used as a wildcard; null for no filter.
  getCredentials: function(aFilter) {
    let count = DWORD();
    let credentials = PCREDENTIAL_ARRAY();
    let result = this._credentialLib.CredEnumerate(aFilter, 0,
                                                   count.address(),
                                                   credentials.address());

    if (!result || !count.value)
      return [];

    // The unbounded PCREDENTIAL_ARRAY must be cast to a fixed-length array.
    let castCredentials =
      ctypes.cast(credentials, PCREDENTIAL.array(count.value).ptr);

    let credArray = [];
    for (let i = 0; i < count.value; ++i) {
      let cred = new Credential(castCredentials.contents[i].contents);
      credArray.push(cred);
    }

    // Credentials must be "freed." This is done after reading the values.
    this._credentialLib.CredFree(credentials);
    return credArray;
  },

  _credentialLib: {
    // The "Advanced Windows 32 Base API DLL" has methods for
    // access of the Windows Credential Store.
    advapi32: null,
    shutdown: function() {
      this.advapi32.close()
    },
    init: function() {
      this.advapi32 = ctypes.open("Advapi32");

      // Low-level Credentials Management Functions

      // "The CredEnumerate function enumerates the credentials from
      // the user's credential set."
      //  http://msdn.microsoft.com/en-us/library/aa374794.aspx
      this.CredEnumerate = this.advapi32.declare("CredEnumerateW",
        ctypes.default_abi,
        ctypes.bool,
        LPCTSTR,       // Filter
        DWORD,         // Flags
        DWORD.ptr,     // *Count
        PCREDENTIAL_ARRAY.ptr // **Credentials
      );

      // "The CredFree function frees a buffer returned by any of
      // the credentials management functions."
      //  http://msdn.microsoft.com/en-us/library/aa374796.aspx
      this.CredFree = this.advapi32.declare("CredFree",
        ctypes.default_abi,
        ctypes.void_t,
        PVOID  // Buffer
      );
    }
  }
};

// This is a JavaScript object that represents the CREDENTIAL struct
// without js-ctypes. These are interacted with after a call to
// getCredentials() in CredentialStore.
function Credential(aCredStruct) {
  // "A bit member that identifies characteristics of the credential."
  // The bits are defined below (flagValues)
  this.flags = aCredStruct.Flags;

  // "The type of the credential."
  this.type = aCredStruct.Type;

  // "The name of the credential. The TargetName and Type members
  // uniquely identify the credential."
  this.targetName = aCredStruct.TargetName.readString();

  // "A string comment from the user that describes this credential. This member
  // cannot be longer than CRED_MAX_STRING_LENGTH (256) characters."
  if (!aCredStruct.Comment.isNull())
    this.comment = aCredStruct.Comment.readString();

  // "The time, in Coordinated Universal Time (Greenwich Mean Time),
  // of the last modification of the credential."
  this.lastWritten = aCredStruct.LastWritten.contents;

  // "The size, in bytes, of the CredentialBlob member. This member cannot
  // be larger than CRED_MAX_CREDENTIAL_BLOB_SIZE (512) bytes."
  this.credentialBlobSize = aCredStruct.CredentialBlobSize;

  // "Secret data for the credential.
  // - If the Type member is CRED_TYPE_DOMAIN_PASSWORD, this member
  //   contains the plaintext Unicode password for UserName.
  // - If the Type member is CRED_TYPE_DOMAIN_CERTIFICATE, this member
  //   contains the clear test Unicode PIN for UserName.
  // - If the Type member is CRED_TYPE_GENERIC, this member is
  //   defined by the application.
  // The application defines the byte-endian and alignment of the
  // data in CredentialBlob."
  if (this.credentialBlobSize)
    this.credentialBlob = aCredStruct.CredentialBlob.readString();

  // Defines the persistence of this credential.
  this.persist = aCredStruct.Persist;

  // "Alias for the TargetName member." The credential manager
  // ignores the value for CRED_TYPE_GENERIC credentials.
  if (!aCredStruct.TargetAlias.isNull() &&
      this.type != this.typeValues.CRED_TYPE_GENERIC) {
    this.targetAlias = aCredStruct.TargetAlias.readString();
  }

  // "The user name of the account used to connect to TargetName.
  // - If the credential Type is CRED_TYPE_DOMAIN_PASSWORD, this member
  //   can be either a 'DomainName\UserName' or a UPN.
  // - If the credential Type is CRED_TYPE_DOMAIN_CERTIFICATE, this member
  //   must be a marshaled certificate reference created by calling
  //   CredMarshalCredential with a CertCredential.
  // - If the credential Type is CRED_TYPE_GENERIC, this member can be
  //   non-NULL, but the credential manager ignores the member.
  // This member cannot be longer than CRED_MAX_USERNAME_LENGTH characters.
  if (!aCredStruct.UserName.isNull())
    this.username = aCredStruct.UserName.readString();
}
Credential.prototype = {
  typeValues: {
    CRED_TYPE_GENERIC: 1,
    CRED_TYPE_DOMAIN_PASSWORD: 2,
    CRED_TYPE_DOMAIN_CERTIFICATE: 3,
    CRED_TYPE_DOMAIN_VISIBLE_PASSWORD: 4,
    CRED_TYPE_GENERIC_CERTIFICATE: 5,
    CRED_TYPE_DOMAIN_EXTENDED: 6
  }
};
