/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://test/importerTestHelper.jsm");

// These tests verify that the password methods used in the Google Talk
// importer produce the correct results.
function run_test() {
  add_test(test_entropyInitialization);
  run_next_test();
}

// This test checks that the GTalk importer correctly creates the entropy data
// necessary for decrypting and decoding the user's password.
function test_entropyInitialization() {
  const USERNAME_DOMAIN_PAIRS = [
    {user: "User", domain: "Domain"},
    {user: "Alph4Num3r1c", domain: "Us3r-PC"},
    {user: "Sp ace.Dot", domain: "Dot.domain"}
  ];

  const FINAL_ENTROPY = [
    Uint32Array([0x436f14d3, 0xc6125cd9, 0xb62cc8b6, 0xab23ae8a]),
    Uint32Array([0x23c1afa5, 0xbebef1e6, 0xa69b9a32, 0xaba71f8f]),
    Uint32Array([0x636add, 0x3292eaed, 0xc57183ed, 0x7707e35a])
  ];

  let importer = importerTestHelper.getImporterJSInstance("googletalk");
  for (let i = 0; i < USERNAME_DOMAIN_PAIRS.length; ++i) {
    // Overwrite the User/Domain retrieval methods.
    importer._getCurrentUser = function() { return USERNAME_DOMAIN_PAIRS[i].user; };
    importer._getCurrentDomain = function() { return USERNAME_DOMAIN_PAIRS[i].domain; };

    // The entropy will be a Uint32Array of length 4.
    let entropy = importer._initializeEntropy();

    // Verify the predicted entropy against the produced.
    for (let j = 0; j < 4; ++j) {
      do_check_eq(FINAL_ENTROPY[i][j], entropy[j]);
    }
  }
  run_next_test();
}
