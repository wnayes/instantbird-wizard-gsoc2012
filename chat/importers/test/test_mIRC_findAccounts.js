/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://test/importerTestHelper.jsm");

var XULAppInfo = {
  vendor: "Mozilla",
  name: "XPCShell",
  ID: "{39885e5f-f6b4-4e2a-87e5-6259ecf79011}",
  version: "5",
  appBuildID: "2007010101",
  platformVersion: "1.9",
  platformBuildID: "2007010101",
  inSafeMode: false,
  logConsoleErrors: true,
  OS: "WINNT", // mIRC requires a Windows OS.
  XPCOMABI: "noarch-spidermonkey",

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIXULAppInfo, Ci.nsIXULRuntime,
                                         Ci.nsISupports])
};

var XULAppInfoFactory = {
  createInstance: function (outer, iid) {
    if (outer != null)
      throw Components.results.NS_ERROR_NO_AGGREGATION;
    return XULAppInfo.QueryInterface(iid);
  }
};

// These tests check the mIRC importer findAccounts() procedure to ensure
// correct account detection and proper exit signaling.
//
// Test 1: Checks if the mIRC importer gracefully exits when no files are present.
// Test 2: Checks if the mIRC importer can handle an empty config file.
// Test 3: Tests the mIRC importer with a typical configuration.
function run_test() {
  // Having an implementation of nsIXULAppInfo is required for Services.jsm
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
            .registerFactory(Components.ID("{48a4e946-1f9f-4224-b4b0-9a54183cb81e}"),
                             "XULAppInfo", "@mozilla.org/xre/app-info;1",
                             XULAppInfoFactory);

  // The core is needed for the mIRC importer to set ExistingAccount settings.
  do_get_profile();
  let core = Cc["@mozilla.org/chat/core-service;1"]
               .getService(Ci.imICoreService);
  core.init();
  do_register_cleanup(function() { core.quit(); }.bind(this));

  // If one or more of the tests fail, the xpcshell testing will stall
  // indefinitely without this. 5 seconds is plenty of time for the tests
  // to complete.
  do_timeout(5000, function() {
    do_throw("A mIRC importer test has not signaled completion!");
  });

  add_test(test_noMircFilesPresent);
  add_test(test_emptyMircINI);
  add_test(test_typicalAccount);
  run_next_test();
}

// It is important that an importer works when no files are present! The test
// should be notified of "account-search-finished" to properly finish.
function test_noMircFilesPresent() {
  let importer = importerTestHelper.getImporterJSInstance("mirc");

  // The current working directory will not have any mIRC files, making
  // it a simple choice to use for testing this case.
  importer._getMircDirectory = function() do_get_cwd().clone();

  // This test will succeed if the specially-crafted observer below receives
  // the "account-search-finished" notification.
  let observer = {
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_throw("test_noMircFilesPresent: \"existing-account-found\" called!");
          break;
        case "account-search-finished":
          run_next_test();
          break;
      }
    }
  };

  importer.findAccounts(observer);
}

// If the mirc.ini file is empty, the importer should not encounter issues
// and properly signal that it is finished.
function test_emptyMircINI() {
  // The test mirc.ini file will be the single space, " ".
  const MIRC_INI_EMPTY = " ";

  // A new directory will be created in the user's Temp folder.
  let newMircDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("mirc.ini", MIRC_INI_EMPTY, newMircDir);

  let importer = importerTestHelper.getImporterJSInstance("mirc");
  importer._getMircDirectory = function() newMircDir.clone();

  let observer = {
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_throw("test_emptyMircINI: \"existing-account-found\" called!");
          break;
        case "account-search-finished":
          run_next_test();
          break;
      }
    }
  };

  // Remove the temporary directory (and dummy mirc.ini) after
  // the test finishes.
  do_register_cleanup(function() { newMircDir.remove(true); }.bind(this));

  importer.findAccounts(observer);
}

// This test verifies that the mIRC importer can find the configured IRC
// account and associated settings from a basic mirc.ini file.
function test_typicalAccount() {
  // The test mirc.ini file will have all of the settings the importer
  // should recognize.
  const MIRC_INI_TYPICAL =
      // The [mirc] section has 'nick' and 'host' keys which are necessary
      // for an account to be created. There are also 'user', 'email', and
      // 'anick' keys that are ignored.
      "[mirc]\r\n"
    + "nick=Testnick\r\n"
    + "host=Some test serverSERVER:irc.testnet.org:1234GROUP:Testnet"
    + "\r\n\r\n"
      // The [options] section has several lines of numerical preferences,
      // split by commas. Refer to the documentation links in mIRC.js for
      // more information; the only one of concern is the first 0/1 boolean
      // of n0, which specifies whether to auto-connect the account.
    + "[options]\r\n"
    + "n0=1,1,0,1,0,0,300,0,0,0,1,0,0,0,0,0,1,0,0"
    + "\r\n\r\n"
      // The [text] section contains one key of interest, the user specified
      // quit message.
    + "[text]\r\n"
    + "quit=I am leaving now!\r\n";

  // A new directory will be created in the user's Temp folder.
  let newMircDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("mirc.ini", MIRC_INI_TYPICAL, newMircDir);

  let importer = importerTestHelper.getImporterJSInstance("mirc");
  importer._getMircDirectory = function() newMircDir.clone();

  // The observer checks that the account described above was successfully
  // parsed by checking values of an ExistingAccount.
  let observer = {
    accountObserved: false,
    settingCount: 0,
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_check_eq(aSubject.name, "Testnick@irc.testnet.org");
          do_check_eq(aSubject.protocolId, "prpl-irc");
          do_check_true(aSubject.autoLogin);

          // Only the non-default PrplPrefs should be present.
          let settings = aSubject.getOptions();
          while (settings.hasMoreElements()) {
            let setting = settings.getNext().QueryInterface(Ci.prplIPref);
            switch (setting.type) {
              case Ci.prplIPref["typeBool"]:
                do_throw("test_typicalAccount: Boolean pref found but none were set!");
                break;
              case Ci.prplIPref["typeInt"]:
                do_check_eq(setting.name, "port");
                do_check_eq(setting.getInt(), 1234);
                break;
              case Ci.prplIPref["typeString"]:
                do_check_eq(setting.name, "quitmsg");
                do_check_eq(setting.getString(), "I am leaving now!");
                break;
              case Ci.prplIPref["typeList"]:
              default:
                do_throw("test_typicalAccount: Bad type on ExistingAccount PrplPref");
            }
            this.settingCount++;
          }
          this.accountObserved = true;
          break;
        case "account-search-finished":
          do_check_true(this.accountObserved);
          do_check_eq(this.settingCount, 2);
          run_next_test();
          break;
      }
    }
  };

  // Remove the temporary directory after the test finishes.
  do_register_cleanup(function() { newMircDir.remove(true); }.bind(this));

  importer.findAccounts(observer);
}
