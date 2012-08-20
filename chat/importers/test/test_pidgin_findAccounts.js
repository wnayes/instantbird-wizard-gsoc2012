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

// These tests check the Pidgin importer findAccounts() procedure to ensure
// correct account detection and proper exit signaling.
//
// Test 1: Checks that the importer exits properly with no files present.
// Test 2: Tests when Pidgin's "accounts.xml" exists but is empty.
// Test 3: Tests that unknown protocol accounts are not created.
// Test 4: Checks that the importer handles common name/protocol replacements.
// Test 5: Ensures a typical account is read properly.
function run_test() {
  // Having an implementation of nsIXULAppInfo is required for Services.jsm
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
            .registerFactory(Components.ID("{48a4e946-1f9f-4224-b4b0-9a54183cb81e}"),
                             "XULAppInfo", "@mozilla.org/xre/app-info;1",
                             XULAppInfoFactory);

  // The core is needed for the Pidgin importer to check prpl-id validity.
  do_get_profile();
  let core = Cc["@mozilla.org/chat/core-service;1"]
               .getService(Ci.imICoreService);
  core.init();
  do_register_cleanup(function() { core.quit(); }.bind(this));

  // If one or more of the tests fail, the xpcshell testing will stall
  // indefinitely without this. 5 seconds is plenty of time for the tests
  // to complete.
  do_timeout(5000, function() {
    do_throw("A Pidgin importer test has not signaled completion!");
  });

  add_test(test_noPurpleFilesPresent);
  add_test(test_emptyAccountXML);
  add_test(test_unsupportedProtocol);
  add_test(test_nameProtocolModifications);
  add_test(test_typicalAccount);
  run_next_test();
}

// It is important that an importer works when no files are present! The test
// should be notified of "account-search-finished" to properly finish.
function test_noPurpleFilesPresent() {
  let importer = importerTestHelper.getImporterJSInstance("pidgin");

  // The current working directory will not have any .purple/ files, making
  // it a simple choice to use for testing this case.
  importer._getPurpleDirectory = function() do_get_cwd().clone();

  // This test will succeed if the specially-crafted observer below receives
  // the "account-search-finished" notification.
  let observer = {observe: function(aSubject, aTopic, aData) {
    switch (aTopic) {
      case "existing-account-found":
        do_throw("test_noPurpleFilesPresent: \"existing-account-found\" called!");
        break;
      case "account-search-finished":
        run_next_test();
        break;
    }
  }};

  importer.findAccounts(observer);
}

// If the accounts.xml file is empty, the importer should not encounter issues
// and properly signal that it is finished.
function test_emptyAccountXML() {
  // The test accounts.xml file in this test will be the single space, " ".
  const ACCOUNT_XML_EMPTY = " ";

  // A new directory will be created in the user's Temp folder.
  let newPurpleDir = importerTestHelper.createTempDirectory();

  importerTestHelper.writeTestFile("accounts.xml", ACCOUNT_XML_EMPTY, newPurpleDir);
  let importer = importerTestHelper.getImporterJSInstance("pidgin");
  importer._getPurpleDirectory = function() newPurpleDir.clone();

  let observer = {observe: function(aSubject, aTopic, aData) {
    switch (aTopic) {
      case "existing-account-found":
        do_throw("test_emptyAccountXML: \"existing-account-found\" called!");
        break;
      case "account-search-finished":
        run_next_test();
        break;
    }
  }};

  // Remove the temporary directory (and dummy accounts.xml) after
  // the test finishes.
  do_register_cleanup(function() { newPurpleDir.remove(true); }.bind(this));

  importer.findAccounts(observer);
}

// Pidgin supports several prpl-ids that Instantbird does not use. This test
// checks that these are correctly ignored.
function test_unsupportedProtocol() {
  // The test accounts.xml file in this test will have both a valid and invalid
  // importable account information. Instantbird supports prpl-aim but does not
  // support prpl-faketest.
  const ACCOUNT_XML_UNSUPPORTED = "<?xml version='1.0' encoding='UTF-8' ?>"
    + "<account version='1.0'>"
    + "  <account>"
    + "    <protocol>prpl-aim</protocol>"
    + "    <name>Supported</name>"
    + "  </account>"
    + "  <account>"
    + "    <protocol>prpl-faketest</protocol>"
    + "    <name>Unsupported</name>"
    + "  </account>"
    + "</account>";

  let newPurpleDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("accounts.xml", ACCOUNT_XML_UNSUPPORTED, newPurpleDir);

  let importer = importerTestHelper.getImporterJSInstance("pidgin");
  importer._getPurpleDirectory = function() newPurpleDir.clone();

  // When the observer receives the accounts, two boolean properties
  // will be toggled as needed. When the imported claims to be done,
  // these will determine pass/fail.
  let observer = {
    foundsupported: false,
    foundunsupported: false,
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          if (aSubject.name === "Supported" && aSubject.protocolId === "prpl-aim")
            this.foundsupported = true;
          else if (aSubject.name === "Unsupported" && aSubject.protocolId === "prpl-faketest")
            this.foundunsupported = true;
          else
            do_throw("test_unsupportedProtocol: An unrecognized account was found!");
          break;
        case "account-search-finished":
          do_check_true(this.foundsupported);
          do_check_false(this.foundunsupported);
          run_next_test();
          break;
      }
    }
  };

  // Remove the temporary directory after the test finishes.
  do_register_cleanup(function() { newPurpleDir.remove(true); }.bind(this));

  importer.findAccounts(observer);
}

// Certain combinations of name and protocol are represented better in
// a different form in Instantbird. This test checks whether the
// Pidgin importer is recognizing these common forms.
function test_nameProtocolModifications() {
  // The test accounts.xml file in this test has both name/protocol
  // combinations that should be changed, as well as those that should
  // be left as-is.
  const ACCOUNT_XML_NAMEPROTOCOLMOD = "<?xml version='1.0' encoding='UTF-8' ?>"
    + "<account version='1.0'>"
         // There is a prpl-facebook id that is more suitable for
         // XMPP Facebook communications.
    + "  <account>"
    + "    <protocol>prpl-jabber</protocol>"
    + "    <name>test1@chat.facebook.com/</name>"
    + "  </account>"

         // Similar to above, prpl-gtalk would suit Google accounts better.
    + "  <account>"
    + "    <protocol>prpl-jabber</protocol>"
    + "    <name>test2@gmail.com/</name>"
    + "  </account>"

         // This XMPP account should simply be left alone.
    + "  <account>"
    + "    <protocol>prpl-jabber</protocol>"
    + "    <name>test3@testdomain.com/</name>"
    + "  </account>"
    + "</account>";

  let newPurpleDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("accounts.xml", ACCOUNT_XML_NAMEPROTOCOLMOD, newPurpleDir);

  let importer = importerTestHelper.getImporterJSInstance("pidgin");
  importer._getPurpleDirectory = function() newPurpleDir.clone();

  // The observer checks for the correct converted account information, and
  // sets booleans accordingly.
  let observer = {
    XMPPFacebookChange: false,
    XMPPGTalkChange: false,
    XMPPNoChange: false,
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          if (aSubject.name === "test1" &&
              aSubject.protocolId === "prpl-facebook") {
            this.XMPPFacebookChange = true;
          }
          else if (aSubject.name === "test2@gmail.com/" &&
                   aSubject.protocolId === "prpl-gtalk") {
            this.XMPPGTalkChange = true;
          }
          else if (aSubject.name === "test3@testdomain.com/" &&
                   aSubject.protocolId === "prpl-jabber") {
            this.XMPPNoChange = true;
          }
          break;
        case "account-search-finished":
          do_check_true(this.XMPPFacebookChange);
          do_check_true(this.XMPPGTalkChange);
          do_check_true(this.XMPPNoChange);
          run_next_test();
          break;
      }
    }
  };

  // Remove the temporary directory after the test finishes.
  do_register_cleanup(function() { newPurpleDir.remove(true); }.bind(this));

  importer.findAccounts(observer);
}

// This test checks the overall success of the importer in finding and setting
// the full range of supported account settings from Pidgin.
function test_typicalAccount() {
  // The test accounts.xml file in this test is a good example of what might be
  // typically found in a user's .purple directory.
  const ACCOUNT_XML_TYPICAL = "<?xml version='1.0' encoding='UTF-8' ?>"
    + "<account version='1.0'>"
    + "  <account>"
    + "    <protocol>prpl-msn</protocol>"
    + "    <name>msnUser@msn.com/</name>"
    + "    <password>password</password>"
    + "    <alias>msnUserAlias</alias>"

           // The importer should correctly parse through potentially multiple
           // <settings> tags per account. The settings that are relevant
           // should be attached to the ExistingAccount - that is, settings
           // that are usable and non-default.
    + "    <settings>"
    + "      <setting name='http_method' type='bool'>0</setting>"
    + "      <setting name='endpoint-name' type='string'>Pidgin</setting>"
    + "      <setting name='check-mail' type='bool'>0</setting>"
    + "      <setting name='buddy_icon'/>"
    + "      <setting name='buddy_icon_timestamp' type='int'>0</setting>"
    + "      <setting name='http_method_server' type='string'>gateway.messenger.hotmail.com</setting>"
    + "      <setting name='use-global-buddyicon' type='bool'>1</setting>"
    + "      <setting name='mpop' type='bool'>0</setting>" // Non-default
    + "      <setting name='server' type='string'>fake.hotmail.com</setting>" // Non-default
    + "      <setting name='custom_smileys' type='bool'>1</setting>"
    + "      <setting name='port' type='int'>9001</setting>" // Non-default
    + "      <setting name='direct_connect' type='bool'>1</setting>"
    + "    </settings>"
    + "    <settings ui='gtk-gaim'>"
             // auto-login is not stored in the same way as other settings,
             // it has its own property in ExistingAccount.
    + "      <setting name='auto-login' type='bool'>1</setting>"
    + "    </settings>"
    + "  </account>"
    + "</account>";

  let newPurpleDir = importerTestHelper.createTempDirectory();
  importerTestHelper.writeTestFile("accounts.xml", ACCOUNT_XML_TYPICAL, newPurpleDir);

  let importer = importerTestHelper.getImporterJSInstance("pidgin");
  importer._getPurpleDirectory = function() newPurpleDir.clone();

  // The observer checks that the account described above was successfully
  // parsed by checking values of an ExistingAccount.
  let observer = {
    accountObserved: false,
    settingCount: 0,
    observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
        case "existing-account-found":
          do_check_eq(aSubject.name, "msnUser@msn.com/");
          do_check_eq(aSubject.protocolId, "prpl-msn");
          do_check_eq(aSubject.password, "password");
          do_check_eq(aSubject.alias, "msnUserAlias");
          do_check_true(aSubject.autoLogin);

          // Only the non-default PrplPrefs should be present.
          let settings = aSubject.getOptions();
          while (settings.hasMoreElements()) {
            let setting = settings.getNext().QueryInterface(Ci.prplIPref);
            switch (setting.type) {
              case Ci.prplIPref["typeBool"]:
                do_check_eq(setting.name, "mpop");
                do_check_false(setting.getBool());
                break;
              case Ci.prplIPref["typeInt"]:
                do_check_eq(setting.name, "port");
                do_check_eq(setting.getInt(), 9001);
                break;
              case Ci.prplIPref["typeString"]:
                do_check_eq(setting.name, "server");
                do_check_eq(setting.getString(), "fake.hotmail.com");
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
          do_check_eq(this.settingCount, 3);
          run_next_test();
          break;
      }
    }
  };

  // Remove the temporary directory after the test finishes.
  do_register_cleanup(function() { newPurpleDir.remove(true); }.bind(this));

  importer.findAccounts(observer);
}
