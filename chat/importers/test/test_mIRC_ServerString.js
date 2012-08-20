/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://test/importerTestHelper.jsm");

// These tests check the mIRC importer's ability to correctly parse the
// unusual string format of the server preference.
function run_test() {
  add_test(test_variousValidServers);
  run_next_test();
}

// This test checks the correct parsing of various server strings
// created in the mirc.ini configuration file.
function test_variousValidServers() {
  const MIRC_SERVER_PORT_STRINGS = [
    "Random serverSERVER:irc.mozilla.org:6667GROUP:Mozilla",
    "Random serverSERVER:chat.freenode.net:6666GROUP:Freenode",
    "CA, ON, TorontoSERVER:irc.teksavvy.ca:6663GROUP:EFnet",
    "US, VA, RichmondSERVER:punch.va.us.dal.net:6668GROUP:DALnet"
  ];

  // These are the expected results after parsing the host, port, and group
  // from the above strings.
  const MIRC_SERVERS = [
    "irc.mozilla.org", "chat.freenode.net",
    "irc.teksavvy.ca", "punch.va.us.dal.net"
  ];
  const MIRC_PORTS = [ 6667, 6666, 6663, 6668 ];
  const MIRC_GROUPS = ["Mozilla", "Freenode", "EFnet", "DALnet"];

  let importer = importerTestHelper.getImporterJSInstance("mirc");
  for (let i = 0; i < MIRC_SERVER_PORT_STRINGS.length; ++i) {
    let servInfo = importer._parseServerString(MIRC_SERVER_PORT_STRINGS[i]);

    do_check_eq(servInfo.host, MIRC_SERVERS[i]);
    do_check_eq(servInfo.port, MIRC_PORTS[i]);
    do_check_eq(servInfo.group, MIRC_GROUPS[i]);
  }
  run_next_test();
}
