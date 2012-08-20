/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const EXPORTED_SYMBOLS = ["importerTestHelper"];

const {classes: Cc, interfaces: Ci} = Components;

// This helper provides commonly needed methods to the importer XPCShell tests.
const importerTestHelper = {
  // Create a unique instance of an importer.
  getImporterJSInstance: function(aImporterName) {
    let cid;
    let importerName = aImporterName.toLowerCase();
    if (importerName === "googletalk")
      cid = "@mozilla.org/chat/googletalkimporter;1"
    else if (importerName === "mirc")
      cid = "@mozilla.org/chat/mircimporter;1";
    else if (importerName === "pidgin")
      cid = "@mozilla.org/chat/pidginimporter;1";
    else if (importerName === "xchat")
      cid = "@mozilla.org/chat/xchatimporter;1";
    else {
      dump("importerTestHelper must be updated to support this ID!");
      return null;
    }
    return Cc[cid].createInstance().wrappedJSObject;
  },

  // Create a unique temporary directory for writing some test files.
  createTempDirectory: function() {
    let tempDir = Services.dirsvc.get("TmpD", Ci.nsIFile);
    tempDir.append("ixpctesttmp");
    tempDir.createUnique(Ci.nsIFile.DIRECTORY_TYPE, 0666);
    return tempDir.clone();
  },

  // Synchronously write a file to a specified directory.
  writeTestFile: function(aFilename, aStringContents, aDirectory) {
    let tempFile = aDirectory.clone();
    tempFile.append(aFilename);

    // A synchronous write, see
    // https://developer.mozilla.org/en/Code_snippets/File_I//O#Writing_a_File
    let foStream = Cc["@mozilla.org/network/file-output-stream;1"]
                     .createInstance(Ci.nsIFileOutputStream);
    foStream.init(tempFile, 0x02 | 0x08 | 0x20, 0666, 0);
    foStream.write(aStringContents, aStringContents.length);
    foStream.close();
  }
};
