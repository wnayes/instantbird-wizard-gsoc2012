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
  OS: "XPCShell",
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

// These tests check the XChat importer findAccounts() procedure to ensure
// correct account detection and proper exit signaling.
//
// Test 1: Checks for a proper exit when no files are found.
// Test 2: Checks that an empty "xchat.conf" causes no problems.
// Test 3: A similar check as above, but with an empty "servlist_.conf".
// Test 4: Checking that an invalid server index doesn't cause problems.
// Test 5: Tests that a regular account and settings can be found.
function run_test() {
  // Having an implementation of nsIXULAppInfo is required for Services.jsm
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
            .registerFactory(Components.ID("{48a4e946-1f9f-4224-b4b0-9a54183cb81e}"),
                             "XULAppInfo", "@mozilla.org/xre/app-info;1",
                             XULAppInfoFactory);

  // The core is needed to set ExistingAccount settings.
  do_get_profile();
  let core = Cc["@mozilla.org/chat/core-service;1"]
               .getService(Ci.imICoreService);
  core.init();
  do_register_cleanup(function() { core.quit(); }.bind(this));

  // If one or more of the tests fail, the xpcshell testing will stall
  // indefinitely without this. 5 seconds is plenty of time for the tests
  // to complete.
  do_timeout(5000, function() {
    do_throw("A XChat importer test has not signaled completion!");
  });

  add_test(test_noXChatFilesPresent);
  add_test(test_emptyXChatConf);
  add_test(test_emptyServerList);
  add_test(test_badServerIndex);
  add_test(test_typicalAccount);
  run_next_test();
}

// It is important that an importer works when no files are present! The test
// should be notified of "account-search-finished" to properly finish.
function test_noXChatFilesPresent() {
  let importer = importerTestHelper.getImporterJSInstance("xchat");

  // The current working directory will not have any XChat files, making
  // it a simple choice to use for testing this case.
  importer._getXChatDirectory = function() {
    return do_get_cwd().clone();
  };

  // This test will succeed if the specially-crafted observer below receives
  // the "account-search-finished" notification.
  let observer = {
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_throw("test_noXchatFilesPresent: \"existing-account-found\" called!");
          break;
        case "account-search-finished":
          run_next_test();
          break;
      }
    }
  };

  importer.findAccounts(observer);
}

// If the xchat.conf file is empty, the importer should not encounter issues
// and properly signal that it is finished.
function test_emptyXChatConf() {
  // The test xchat.conf file will be the single space, " ".
  const XCHAT_CONF_EMPTY = " ";

  // A new directory will be created in the user's Temp folder.
  let newXChatDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("xchat.conf", XCHAT_CONF_EMPTY, newXChatDir);

  let importer = importerTestHelper.getImporterJSInstance("xchat");
  importer._getXChatDirectory = function() newXChatDir.clone();

  let observer = {
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_throw("test_emptyXChatConf: \"existing-account-found\" called!");
          break;
        case "account-search-finished":
          run_next_test();
          break;
      }
    }
  };

  // Remove the temporary directory (and dummy xchat.conf) after
  // the test finishes.
  do_register_cleanup(function() { try {newXChatDir.remove(true); } catch(e) {} }.bind(this));

  importer.findAccounts(observer);
}

// If the servlist_.conf file is empty, the importer will be unable to
// find the specified server and should properly exit.
function test_emptyServerList() {
  // The test xchat.conf file in this case is not the source of error.
  const XCHAT_CONF_SERVERLIST =
    "version = 2.8.9\n" +
    "irc_nick1 = Nick1\n" +
    "gui_slist_select = 5\n";

  // The test servlist_.conf is empty in this test.
  const SERVLIST_EMPTY = " "

  let newXChatDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("xchat.conf", XCHAT_CONF_SERVERLIST, newXChatDir);
  importerTestHelper.writeTestFile("servlist_.conf", SERVLIST_EMPTY, newXChatDir);

  let importer = importerTestHelper.getImporterJSInstance("xchat");
  importer._getXChatDirectory = function() newXChatDir.clone();

  let observer = {
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_throw("test_emptyServerList: \"existing-account-found\" called!");
          break;
        case "account-search-finished":
          run_next_test();
          break;
      }
    }
  };

  // Remove the temporary directory after the test finishes.
  do_register_cleanup(function() { try {newXChatDir.remove(true); } catch(e) {} }.bind(this));

  importer.findAccounts(observer);
}

const SERVLIST_SMALL = "v=2.8.9\n\n"
  + "N=Test2net\n"
  + "E=IRC (Latin/Unicode Hybrid)\n"
  + "F=19\n"
  + "D=0\n"
  + "S=irc.test2.net\n\n"
  + "N=MoreTest\n"
  + "E=IRC (Latin/Unicode Hybrid)\n"
  + "F=19\n"
  + "D=0\n"
  + "S=irc.7-tests.org\n\n"
  + "N=AccessTEST\n"
  + "E=IRC (Latin/Unicode Hybrid)\n"
  + "F=19\n"
  + "D=0\n"
  + "S=irc.accesstest.net\n"
  + "S=eu.accesstest.net\n";

// The xchat.conf file could request an invalid server index from an otherwise
// valid servlist_.conf
function test_badServerIndex() {
  // The test xchat.conf file in this case is not the source of error.
  const XCHAT_CONF_BADINDEX =
    "version = 2.8.9\n" +
    "irc_nick1 = Nick1\n" +
    "gui_slist_select = 10\n";

  let newXChatDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("xchat.conf", XCHAT_CONF_BADINDEX, newXChatDir);
  importerTestHelper.writeTestFile("servlist_.conf", SERVLIST_SMALL, newXChatDir);

  let importer = importerTestHelper.getImporterJSInstance("xchat");
  importer._getXChatDirectory = function() newXChatDir.clone();

  let observer = {
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_throw("test_badServerIndex: \"existing-account-found\" called!");
          break;
        case "account-search-finished":
          run_next_test();
          break;
      }
    }
  };

  // Remove the temporary directory after the test finishes.
  do_register_cleanup(function() { try {newXChatDir.remove(true); } catch(e) {} }.bind(this));

  importer.findAccounts(observer);
}

// This is a basic test of the XChat importer's ability to read the configured
// IRC account and associated settings.
function test_typicalAccount() {
  // The test xchat.conf file in this case is not the source of error.
  const XCHAT_CONF_NORMAL =
    "version = 2.8.9\n" +
    "irc_nick1 = Nick1\n" +
    "gui_slist_select = 1\n" +
    "irc_part_reason = Parting to test\n" +
    "irc_quit_reason = Quiting to get some sleep\n";

  let newXChatDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("xchat.conf", XCHAT_CONF_NORMAL, newXChatDir);
  importerTestHelper.writeTestFile("servlist_.conf", SERVLIST_SMALL, newXChatDir);

  let importer = importerTestHelper.getImporterJSInstance("xchat");
  importer._getXChatDirectory = function() newXChatDir.clone();

  let observer = {
    accountObserved: false,
    settingCount: 0,
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_check_eq(aSubject.name, "Nick1@irc.7-tests.org");
          do_check_eq(aSubject.protocolId, "prpl-irc");

          // Only the non-default PrplPrefs should be present.
          let settings = aSubject.getOptions();
          while (settings.hasMoreElements()) {
            let setting = settings.getNext().QueryInterface(Ci.prplIPref);
            switch (setting.type) {
              case Ci.prplIPref["typeString"]:
                if (setting.name === "partmsg")
                  do_check_eq(setting.getString(), "Parting to test");
                else if (setting.name === "quitmsg")
                  do_check_eq(setting.getString(), "Quiting to get some sleep");
                else
                  do_throw("test_typicalAccount: Invalid string preference!");
                break;
              case Ci.prplIPref["typeBool"]:
              case Ci.prplIPref["typeInt"]:
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
  do_register_cleanup(function() { try {newXChatDir.remove(true); } catch(e) {} }.bind(this));

  importer.findAccounts(observer);
}
