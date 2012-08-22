/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
 
// This file contained the original account wizard found in all previous
// Instantbird releases. Numerous changes were made to add the account
// importing functionality. To see exactly what was changed, consider
// looking in the GSoCFinalSubmission.patch:
// https://github.com/wnayes/instantbird-wizard-gsoc2012/blob/master/GSoCFinalSubmission.patch#L4773

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource:///modules/imServices.jsm");

const PREF_EXTENSIONS_GETMOREPROTOCOLSURL = "extensions.getMoreProtocolsURL";

var accountWizard = {
  // As accounts are configured, the settings for each will be kept in a array
  // and push/pop will be performed as necessary during Next/Back commands.
  accounts: [],
  onload: function aw_onload() {
    let wizard = document.getElementById("accountWizard");
    let bundle = document.getElementById("accountWizardBundle");
    wizard.getPageById("accounttoplist").newaccount = true;

    Services.obs.addObserver(this, "prpl-quit", false);
    window.addEventListener("unload", this.unload);

    // The import wizard functionality may be turned off (hidden).
    if (!Services.prefs.getBoolPref("messenger.importWizard.enabled")) {
      this.hideWelcomePage();
      wizard.goTo("accounttoplist");
    }
  },

  unload: function aw_unload() {
    Services.obs.removeObserver(accountWizard, "prpl-quit");
  },

  observe: function am_observe(aObject, aTopic, aData) {
    if (aTopic == "prpl-quit") {
      // libpurple is being uninitialized. We can't create any new
      // account so keeping this wizard open would be pointless, close it.
      window.close();
    }
    else if (aTopic == "account-search-finished") {
      this._searching = false;
      let wizard = document.getElementById("accountWizard");
      let bundle = document.getElementById("accountWizardBundle");
      wizard.getButton("next").disabled = false;
      let accountSummaryList = document.getElementById("accountSummaryList");
      let searchImage = document.getElementById("accountSearchStatusImage");
      let searchStatus = document.getElementById("accountImportStatus");
      if (accountSummaryList.itemCount > 0) {
        searchImage.className = "accountSearchSuccessful";
        searchStatus.textContent =
          bundle.getFormattedString("searchStatus.success.label", [this.searchCount]);
      }
      else {
        searchImage.className = "accountSearchFailure";
        searchStatus.textContent = bundle.getString("searchStatus.failure.label");
        document.getElementById("accountSkipLabel").hidden = true;
        wizard.getButton("extra1").hidden = true;
        wizard.currentPage.next = "accounttoplist";
      }
    }
    else if (aTopic == "existing-account-found") {
      // Add a new item to the accountSummaryList with an existingAccount binding
      let accountSummaryList = document.getElementById("accountSummaryList");
      for (let i = 0; i < accountSummaryList.itemCount; ++i) {
        let listedAccount = accountSummaryList.getItemAtIndex(i);
        if (listedAccount.className !== "existingAccount")
          return;

        // Check if this account has been found already from a different client,
        // and if so, only add an importer entry rather than a new item.
        if (listedAccount.compareToAccount(aObject)) {
          listedAccount.addAccount(aObject);

          // TODO: Compare modifiedDates/set settings?
          return;
        }
      }

      // Avoid allowing the user to import an account that already exists.
      let accProtocol = Services.core.getProtocolById(aObject.protocolId);
      if (accProtocol.accountExists(aObject.name))
        return;

      let item = document.createElement("richlistitem");
      item.className = "existingAccount";
      accountSummaryList.appendChild(item);
      item.build(aObject);
      this.searchCount++;
    }
  },

  showWelcomePage: function() {
    let wizard = document.getElementById("accountWizard");

    // Configure the extra1 button to act with "Skip" functionality.
    let skipButton = wizard.getButton("extra1");
    let nextButton = wizard.getButton("next");
    skipButton.hidden = false;
    if (!skipButton.label) {
      let bundle = document.getElementById("accountWizardBundle");
      skipButton.label = bundle.getString("skipButton.label");
      skipButton.accessKey = bundle.getString("skipButton.accessKey");
    }

    // The import wizard functionality may be turned off (hidden).
    if (Services.prefs.getBoolPref("messenger.importWizard.enabled"))
      this.startImportSearch();
  },

  hideWelcomePage: function() {
    let wizard = document.getElementById("accountWizard");
    wizard.getButton('extra1').hidden = true;
    wizard.getButton('next').disabled = false;
  },

  startImportSearch: function() {
    // Protect against rapid Back/Next causing duplicate searching.
    if (this._searching)
      return;

    this.clearSummaryList("existingAccount");

    // Prepare the UI elements to show the search progress.
    let bundle = document.getElementById("accountWizardBundle");
    let status = document.getElementById("accountImportStatus");
    status.textContent = bundle.getString("searchStatus.searching.label");
    document.getElementById("accountWizard").getButton("next").disabled = true;
    document.getElementById("accountSkipLabel").hidden = false;
    document.getElementById("accountSearchStatusImage")
            .className = "accountSearchSearching";

    this.searchCount = 0;
    this._searching = true;
    Services.importers.findAccounts(this);
  },

  skipAccountImport: function() {
    let wizard = document.getElementById("accountWizard");
    let summaryList = document.getElementById("accountSummaryList");
    // Remove the existing account summary entries.
    this.clearSummaryList("existingAccount");
    wizard.getPageById("accounttoplist").newaccount = true;
    wizard.advance("accounttoplist");
  },

  selectProtocol: function aw_selectProtocol() {
    let pageId = document.getElementById("accountWizard").currentPage.pageid;
    let listId = pageId == "accounttoplist" ? "topprotolist" : "protolist";
    let protoList = document.getElementById(listId);

    // Create an object to store the values for this account.
    this.accounts.pop();
    this.accounts.push({
      username: {},
      options: [],
      proto: Services.core.getProtocolById(protoList.selectedItem.value)
    });
    return true;
  },

  showTopProtocolPage: function() {
    let wizard = document.getElementById("accountWizard");
    let topProtoList = document.getElementById("topprotolist");

    // Check if the page is being viewed after pressing 'Back' or not.
    if (!wizard.currentPage.newaccount) {
      // Some locales may have no top protocols. The top protocols page should
      // be bypassed (rewound since no new account is being created).
      if (topProtoList.itemCount < 2)
        wizard.rewind();

      let proto = this.getCurrentAccount().proto;
      if (proto) {
        // Select the protocol the user had chosen earlier (if in this list)
        for (let i = 0; i < topProtoList.itemCount; ++i) {
          let protoId = topProtoList.getItemAtIndex(i).value;
          if (proto.id === protoId) {
            topProtoList.selectedIndex = i;
            break;
          }
        }
      }
      return true;
    }
    wizard.currentPage.newaccount = false;

    // Push an empty account stack object for now. selectProtocol() will rewrite
    // an update object on each protocol selection.
    this.accounts.push({username: {}, options: []});

    // Fill the top protocols list if it has not been filled already.
    if (topProtoList.itemCount > 1) {
      topProtoList.selectedIndex = -1;
      return true;
    }

    let bundle = document.getElementById("accountWizardBundle");
    let topProtocols = bundle.getString("topProtocol.list").split(",");
    for each (let topProto in topProtocols) {
      let proto = Services.core.getProtocolById(topProto);
      if (proto == null)
        continue;

      let item = document.createElement("richlistitem");
      item.className = "topProtocol";
      topProtoList.insertBefore(item, document.getElementById("otherListItem"));
      let desc = bundle.getString("topProtocol." + proto.id + ".description");
      item.build(proto, desc);
    }

    // Avoid showing users an empty top protocols page.
    if (topProtoList.itemCount < 2)
      wizard.advance();

    topProtoList.selectedIndex = -1;
    return true;
  },

  rewindTopProtocolPage: function() {
    // The top account on the stack should be removed, as we are either going
    // to the welcome page or the summary page in reverse.
    this.accounts.pop();
  },

  advanceTopProtocolPage: function() {
    let wizard = document.getElementById("accountWizard");
    let selectedProtocol = document.getElementById("topprotolist").selectedItem;
    if (!selectedProtocol || selectedProtocol.id == "otherListItem")
      wizard.getPageById("accounttoplist").next = "accountprotocol";
    else {
      accountWizard.selectProtocol();
      wizard.getPageById("accounttoplist").next = "accountusername";
    }
    return true;
  },

  showProtocolPage: function() {
    let protoList = document.getElementById("protolist");
    if (protoList.itemCount > 0)
      return true;

    accountWizard.setGetMoreProtocols();
    let protos = [];
    for (let proto in accountWizard.getProtocols())
      protos.push(proto);
    protos.sort(function(a, b) a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    for each (let proto in protos) {
      let item = protoList.appendItem(proto.name, proto.id);
      item.setAttribute("image", proto.iconBaseURI + "icon.png");
      item.setAttribute("class", "listitem-iconic");
    }

    protoList.selectedIndex = 0;
    return true;
  },

  getUsername: function aw_getUsername() {
    // If the first username textbox is empty, make sure we return an empty
    // string so that it blocks the 'next' button of the wizard.
    if (!this.userNameBoxes[0].value)
      return "";

    return this.userNameBoxes.reduce(function(prev, elt) prev + elt.value, "");
  },

  checkUsername: function aw_checkUsername() {
    let wizard = document.getElementById("accountWizard");
    let name = accountWizard.getUsername();
    let duplicateWarning = document.getElementById("duplicateAccount");
    if (!name) {
      wizard.canAdvance = false;
      duplicateWarning.hidden = true;
      return;
    }

    let exists = accountWizard.getCurrentAccount().proto.accountExists(name);
    wizard.canAdvance = !exists;
    duplicateWarning.hidden = !exists;
  },

  insertUsernameField: function aw_insertUsernameField(aName, aLabel, aParent,
                                                       aDefaultValue) {
    let hbox = document.createElement("hbox");
    hbox.setAttribute("id", aName + "-hbox");
    hbox.setAttribute("align", "baseline");
    hbox.setAttribute("equalsize", "always");

    let label = document.createElement("label");
    label.setAttribute("value", aLabel);
    label.setAttribute("control", aName);
    label.setAttribute("id", aName + "-label");
    hbox.appendChild(label);

    let textbox = document.createElement("textbox");
    textbox.setAttribute("id", aName);
    textbox.setAttribute("flex", 1);
    if (aDefaultValue)
      textbox.setAttribute("value", aDefaultValue);
    textbox.addEventListener("input", accountWizard.checkUsername);
    hbox.appendChild(textbox);

    aParent.appendChild(hbox);
    return textbox;
  },

  showUsernamePage: function aw_showUsernamePage() {
    let proto = this.getCurrentAccount().proto;
    let bundle = document.getElementById("accountsBundle");
    let usernameInfo;
    let emptyText = proto.usernameEmptyText;
    if (emptyText) {
      usernameInfo =
        bundle.getFormattedString("accountUsernameInfoWithDescription",
                                  [emptyText, proto.name]);
    }
    else {
      usernameInfo =
        bundle.getFormattedString("accountUsernameInfo", [proto.name]);
    }
    document.getElementById("usernameInfo").textContent = usernameInfo;

    let vbox = document.getElementById("userNameBox");
    // remove anything that may be there for another protocol
    let child;
    while ((child = vbox.firstChild))
      vbox.removeChild(child);

    let splits = [];
    for (let split in this.getProtoUserSplits())
      splits.push(split);

    let label = bundle.getString("accountUsername");
    this.userNameBoxes = [this.insertUsernameField("name", label, vbox)];
    this.userNameBoxes[0].emptyText = emptyText;

    for (let i = 0; i < splits.length; ++i) {
      this.userNameBoxes.push({value: splits[i].separator});
      label = bundle.getFormattedString("accountColon", [splits[i].label]);
      let defaultVal = splits[i].defaultValue;
      this.userNameBoxes.push(this.insertUsernameField("username-split-" + i,
                                                       label, vbox,
                                                       defaultVal));
    }

    // Restore the username values if previously set.
    let boxValues = this.getCurrentAccount().username.sections;
    if (boxValues && boxValues.length) {
      for (let i = 0; i < this.userNameBoxes.length; ++i)
        this.userNameBoxes[i].value = boxValues[i];
    }

    this.userNameBoxes[0].focus();
    this.userNameProto = proto.id;
    this.checkUsername();
  },

  hideUsernamePage: function aw_hideUsernamePage() {
    document.getElementById("accountWizard").canAdvance = true;
    let next = "account" +
      (this.getCurrentAccount().proto.noPassword ? "advanced" : "password");
    document.getElementById("accountusername").next = next;
  },

  advanceUsernamePage: function aw_advanceUsernamePage() {
    // Store the username in the accounts stack. We want to be able to retrieve
    // both the complete name and the individual textbox values (if applicable)
    this.getCurrentAccount().username.value = this.getUsername();
    this.getCurrentAccount().username.sections = [];
    for each (let box in this.userNameBoxes)
      this.getCurrentAccount().username.sections.push(box.value);
  },

  showPasswordPage: function aw_showPasswordPage() {
    let password = this.getCurrentAccount().password;
    document.getElementById("password").value = (password ? password : "");
  },

  advancePasswordPage: function aw_advancePasswordPage() {
    this.getCurrentAccount().password = this.getValue("password");
  },

  showAdvanced: function aw_showAdvanced() {
    let proto = this.getCurrentAccount().proto;
/* FIXME
    document.getElementById("newMailNotification").hidden =
      !this.proto.newMailNotification;
*/
    this.populateProtoSpecificBox();

    let proxyVisible = proto.usePurpleProxy;
    if (proxyVisible) {
      this.getCurrentAccount().proxy = Cc["@instantbird.org/purple/proxyinfo;1"]
                                         .createInstance(Ci.purpleIProxyInfo);
      this.getCurrentAccount().proxy.type = Ci.purpleIProxyInfo.useGlobal;
      this.displayProxyDescription();
    }
    document.getElementById("proxyGroupbox").hidden = !proxyVisible;

    let alias = this.getCurrentAccount().alias;
    let aliasBox = document.getElementById("alias");
    aliasBox.value = (alias ? alias : "");
    aliasBox.focus();
  },

  displayProxyDescription: function aw_displayProxyDescription() {
    let type = this.getCurrentAccount().proxy.type;
    let bundle = document.getElementById("proxiesBundle");
    let proxy;
    let result;
    if (type == Ci.purpleIProxyInfo.useGlobal) {
      proxy = Cc["@instantbird.org/libpurple/core;1"]
                .getService(Ci.purpleICoreService).globalProxy;
      type = proxy.type;
    }
    else
      proxy = this.getCurrentAccount().proxy;

    if (type == Ci.purpleIProxyInfo.noProxy)
      result = bundle.getString("proxies.directConnection");

    if (type == Ci.purpleIProxyInfo.useEnvVar)
      result = bundle.getString("proxies.useEnvironment");

    if (!result) {
      // At this point, we should have either a socks or http proxy
      if (type == Ci.purpleIProxyInfo.httpProxy)
        result = bundle.getString("proxies.http");
      else if (type == Ci.purpleIProxyInfo.socks4Proxy)
        result = bundle.getString("proxies.socks4");
      else if (type == Ci.purpleIProxyInfo.socks5Proxy)
        result = bundle.getString("proxies.socks5");
      else
        throw "Unknown proxy type";

      if (result)
        result += " ";

      if (proxy.username)
        result += proxy.username + "@";

      result += proxy.host + ":" + proxy.port;
    }

    document.getElementById("proxyDescription").textContent = result;
  },

  createTextbox: function aw_createTextbox(aType, aValue, aLabel, aName) {
    let box = document.createElement("hbox");
    box.setAttribute("align", "baseline");
    box.setAttribute("equalsize", "always");

    let label = document.createElement("label");
    label.setAttribute("value", aLabel);
    label.setAttribute("control", aName);
    box.appendChild(label);

    let textbox = document.createElement("textbox");
    if (aType)
      textbox.setAttribute("type", aType);
    textbox.setAttribute("value", aValue);
    textbox.setAttribute("id", aName);
    textbox.setAttribute("flex", "1");

    box.appendChild(textbox);
    return box;
  },

  createMenulist: function aw_createMenulist(aList, aLabel, aName) {
    let box = document.createElement("hbox");
    box.setAttribute("align", "baseline");

    let label = document.createElement("label");
    label.setAttribute("value", aLabel);
    label.setAttribute("control", aName);
    box.appendChild(label);

    aList.QueryInterface(Ci.nsISimpleEnumerator);
    let menulist = document.createElement("menulist");
    menulist.setAttribute("id", aName);
    let popup = menulist.appendChild(document.createElement("menupopup"));
    while (aList.hasMoreElements()) {
      let elt = aList.getNext();
      let item = document.createElement("menuitem");
      item.setAttribute("label", elt.name);
      item.setAttribute("value", elt.value);
      popup.appendChild(item);
    }
    box.appendChild(menulist);
    return box;
  },

  populateProtoSpecificBox: function aw_populate() {
    let accObj = this.getCurrentAccount();
    let [proto, id, options] = [accObj.proto, accObj.proto.id, accObj.options];
    let box = document.getElementById("protoSpecific");
    let child;
    while ((child = box.firstChild))
      box.removeChild(child);
    let visible = false;
    for (let opt in this.getProtoOptions(proto.id)) {
      let [text, name] = [opt.label, id + "-" + opt.name];

      // Recall set settings in the account stack object.
      let savedVal;
      for each (let savedOption in options) {
        if (savedOption.name === opt.name)
          savedVal = savedOption.value;
      }

      switch (opt.type) {
      case opt.typeBool:
        let chk = document.createElement("checkbox");
        chk.setAttribute("label", text);
        chk.setAttribute("id", name);
        let chkVal = (savedVal ? savedVal : (opt.getBool() ? "true" : "false"));
        chk.setAttribute("checked", chkVal);
        box.appendChild(chk);
        break;
      case opt.typeInt:
        let intVal = (savedVal ? savedVal : opt.getInt());
        box.appendChild(this.createTextbox("number", intVal, text, name));
        break;
      case opt.typeString:
        let stringVal = (savedVal ? savedVal : opt.getString());
        box.appendChild(this.createTextbox(null, stringVal, text, name));
        break;
      case opt.typeList:
        box.appendChild(this.createMenulist(opt.getList(), text, name));
        let listVal = (savedVal ? savedVal : opt.getListDefault());
        document.getElementById(name).value = listVal;
        break;
      default:
        throw "unknown preference type " + opt.type;
      }
      visible = true;
    }
    document.getElementById("protoSpecificGroupbox").hidden = !visible;
    if (visible) {
      let bundle = document.getElementById("accountsBundle");
      document.getElementById("protoSpecificCaption").label =
        bundle.getFormattedString("protoOptions", [proto.name]);
    }
  },

  advanceOptionsPage: function() {
    let accountObj = this.getCurrentAccount();
    accountObj.alias = this.getValue("alias");
    accountObj.options = [];
    for (let opt in this.getProtoOptions(accountObj.proto.id)) {
      let name = opt.name;
      let eltName = accountObj.proto.id + "-" + name;
      let val = this.getValue(eltName);
      // The value will be undefined if the proto specific groupbox has never been opened
      if (val === undefined)
        continue;
      switch (opt.type) {
      case opt.typeBool:
        if (val != opt.getBool())
          accountObj.options.push({opt: opt, name: name, value: !!val});
        break;
      case opt.typeInt:
        if (val != opt.getInt())
          accountObj.options.push({opt: opt, name: name, value: val});
        break;
      case opt.typeString:
        if (val != opt.getString())
          accountObj.options.push({opt: opt, name: name, value: val});
        break;
      case opt.typeList:
        if (val != opt.getListDefault())
          accountObj.options.push({opt: opt, name: name, value: val});
        break;
      default:
        throw "unknown preference type " + opt.type;
      }
    }
  },

  showSummary: function aw_showSummary() {
    let wizard = document.getElementById("accountWizard");
    let bundle = document.getElementById("accountWizardBundle");
    let summaryList = document.getElementById("accountSummaryList");

    // Configure the extra2 button for "Add another account".
    let addButton = wizard.getButton("extra2");
    addButton.hidden = false;
    if (!addButton.label) {
      addButton.label = bundle.getString("addButton.label");
      addButton.accessKey = bundle.getString("addButton.accessKey");
    }

    // Remove any new account summary entries.
    this.clearSummaryList("newAccount");

    // Add each new account item to the summary list.
    for each (let accountObj in this.accounts) {
      let item = document.createElement("richlistitem");
      item.className = "newAccount";
      summaryList.appendChild(item);
      item.build(accountObj);
    }
  },

  hideSummary: function() {
    document.getElementById("accountWizard").getButton("extra2").hidden = true;
  },

  addAnotherAccount: function() {
    // Users may add multiple accounts through this wizard. The extra2 button
    // calls this method, which will prepare the wizard to create another account.
    let wizard = document.getElementById("accountWizard");
    wizard.getPageById("accounttoplist").newaccount = true;
    wizard.advance("accounttoplist");
  },

  clearSummaryList: function(aItemClass) {
    let summaryList = document.getElementById("accountSummaryList");
    for (let i = (summaryList.itemCount - 1); i >= 0 ; --i) {
      let entry = summaryList.getItemAtIndex(i);
      if (aItemClass && entry.className === aItemClass)
        summaryList.removeItemAt(i);
      else if (!aItemClass)
        summaryList.removeItemAt(i);
    }
  },

  createAccounts: function aw_createAccounts() {
    let accountList = document.getElementById("accountSummaryList");
    for (let i = 0; i < accountList.itemCount; ++i) {
      let entry = accountList.getItemAtIndex(i);
      // If an entry is not checked, it should not be created.
      if (!entry.checked)
        continue;

      if (entry.className == "existingAccount") {
        let existingAcc = entry.account[entry.getSelectedImporterId()];
        let protocol = Services.core.getProtocolById(existingAcc.protocolId);
        let acc = Services.accounts.createAccount(entry.getAttribute("username"),
                                                  protocol.id);
        if (!protocol.noPassword && existingAcc.password)
          acc.password = existingAcc.password;
        if (existingAcc.alias)
          acc.alias = existingAcc.alias;
        let changedOptions = this.getIter(existingAcc.getOptions());
        for (let option in changedOptions) {
          switch(option.type) {
          case option.typeBool:
            acc.setBool(option.name, option.getBool());
            break;
          case option.typeInt:
            acc.setInt(option.name, option.getInt());
            break;
          case option.typeString:
          case option.typeList:
            acc.setString(option.name, option.getString());
            break;
          default:
            throw "accountWizard.createAccounts() setting option of unknown type.";
          }
        }

        let autologin = entry.autologin;
        acc.autoLogin = autologin;

        //TODO: Proxy information from importer?
        acc.save();

        try {
          if (autologin)
            acc.connect();
        } catch (e) {
          // If the connection fails (for example if we are currently in
          // offline mode), we still want to close the account wizard
        }

        if (window.opener) {
          let am = window.opener.gAccountManager;
          if (am)
            am.selectAccount(acc.id);
        }

        // Add this new account to the queue of accounts needing data import.
        Services.importers.queueAccount(acc.id, entry.getSelectedImporterId());
      }
      else if (entry.className == "newAccount") {
        let acc = Services.accounts.createAccount(entry.getAttribute("username"),
                                                  entry.protocolId);
        let protocol = Services.core.getProtocolById(entry.protocolId);
        if (!protocol.noPassword && entry.password)
          acc.password = entry.password;
        if (entry.alias)
          acc.alias = entry.alias;
        for each (let option in entry.options) {
          let opt = option.opt;
          switch(opt.type) {
          case opt.typeBool:
            acc.setBool(option.name, option.value);
            break;
          case opt.typeInt:
            acc.setInt(option.name, option.value);
            break;
          case opt.typeString:
          case opt.typeList:
            acc.setString(option.name, option.value);
            break;
          default:
            throw "accountWizard.createAccounts() setting option of unknown type.";
          }
        }

        let autologin = entry.autologin;
        acc.autoLogin = autologin;

        if (protocol.usePurpleProxy)
          acc.proxyInfo = entry.proxy;

        acc.save();

        try {
          if (autologin)
            acc.connect();
        } catch (e) {
          // If the connection fails (for example if we are currently in
          // offline mode), we still want to close the account wizard
        }

        if (window.opener) {
          let am = window.opener.gAccountManager;
          if (am)
            am.selectAccount(acc.id);
        }
      }
    }

    // This initiates the data importing process. Data will be imported in the
    // background for the user during idle. The process will continue if the
    // program is restarted.
    if (Services.prefs.getBoolPref("messenger.importWizard.enabled"))
      Services.importers.initImporters();
    return true;
  },

  getValue: function aw_getValue(aId) {
    let elt = document.getElementById(aId);
    if ("checked" in elt)
      return elt.checked;
    if ("value" in elt)
      return elt.value;
    // If the groupbox has never been opened, the binding isn't attached
    // so the attributes don't exist. The calling code in showSummary
    // has a special handling of the undefined value for this case.
    return undefined;
  },

  getIter: function(aEnumerator) {
    while (aEnumerator.hasMoreElements())
      yield aEnumerator.getNext();
  },
  getProtocols: function aw_getProtocols()
    this.getIter(Services.core.getProtocols()),
  getProtoOptions: function aw_getProtoOptions(aProtocolId)
    this.getIter(Services.core.getProtocolById(aProtocolId).getOptions()),
  getProtoUserSplits: function aw_getProtoUserSplits()
    this.getIter(this.getCurrentAccount().proto.getUsernameSplit()),

  getCurrentAccount: function aw_getCurrentAccount()
    this.accounts[this.accounts.length - 1],

  onGroupboxKeypress: function aw_onGroupboxKeypress(aEvent) {
    let target = aEvent.target;
    let code = aEvent.charCode || aEvent.keyCode;
    if (code == KeyEvent.DOM_VK_SPACE ||
        (code == KeyEvent.DOM_VK_LEFT && !target.hasAttribute("closed")) ||
        (code == KeyEvent.DOM_VK_RIGHT && target.hasAttribute("closed")))
        this.toggleGroupbox(target.id);
  },

  toggleGroupbox: function aw_toggleGroupbox(id) {
    let elt = document.getElementById(id);
    if (elt.hasAttribute("closed")) {
      elt.removeAttribute("closed");
      if (elt.flexWhenOpened)
        elt.flex = elt.flexWhenOpened;
    }
    else {
      elt.setAttribute("closed", "true");
      if (elt.flex) {
        elt.flexWhenOpened = elt.flex;
        elt.flex = 0;
      }
    }
  },

  openProxySettings: function aw_openProxySettings() {
    window.openDialog("chrome://instantbird/content/proxies.xul", "",
                      "chrome,modal,titlebar,centerscreen",
                      this);
    this.displayProxyDescription();
  },

  // Check for correctness and set URL for the "Get more protocols..."-link
  // Stripped down code from preferences/themes.js
  setGetMoreProtocols: function() {
    let prefURL = PREF_EXTENSIONS_GETMOREPROTOCOLSURL;
    let getMore = document.getElementById("getMoreProtocols");
    let showGetMore = false;
    const nsIPrefBranch2 = Components.interfaces.nsIPrefBranch2;

    if (Services.prefs.getPrefType(prefURL) != nsIPrefBranch2.PREF_INVALID) {
      try {
        let getMoreURL = Cc["@mozilla.org/toolkit/URLFormatterService;1"]
                           .getService(Components.interfaces.nsIURLFormatter)
                           .formatURLPref(prefURL);
        getMore.setAttribute("getMoreURL", getMoreURL);
        showGetMore = getMoreURL != "about:blank";
      }
      catch (e) { }
    }
    getMore.hidden = !showGetMore;
  },

  openURL: function(aURL) {
    let urlUri = Services.io.newURI(aURL, null, null);
    Cc["@mozilla.org/uriloader/external-protocol-service;1"]
      .getService(Ci.nsIExternalProtocolService).loadUrl(urlUri);
  }
};
