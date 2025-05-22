// service-worker.js

// Global Variables
let recentlySelectedEncodingList = [];
const LocaleDependentStaticEncodingList = (chrome.i18n.getMessage('staticEncodingList') || '').split(',');
let ENCODINGS = []; // Will be populated by initializeEncodings

const encodingList = new Map(); // Stores { tabId: encoding }
let defaultEncoding; // Stores the default encoding string if set

// DNR Rule Management
const tabRuleIds = new Map(); // Stores { tabId: ruleId } for tab-specific rules
const DEFAULT_ENCODING_RULE_ID = 1; // A fixed ID for the default encoding rule
let nextDynamicRuleId = DEFAULT_ENCODING_RULE_ID + 1; // Start IDs for dynamic rules after the default

const rtl = chrome.i18n.getMessage('@@bidi_dir') === 'rtl' ? '\u{200f}' : '';
let selectedMenu;

// --- Helper Functions ---
const html_special_chars = html => html
  .replace(/&/g, '&gt;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/ /g, '&nbsp;')
  .replace(/'/g, '&#39;')
  .replace(/"/g, '&quot;')
  .replace(/\r\n?|\n/g, '<br>');

const printEncodingInfo = info => `${info[1]} ${rtl}(${info[0]})`;

// This function will be injected into the target page for file:// URLs
function stringToFunc(is_html, data) {
  const _t = document.open('text/' + (is_html ? 'html' : 'plain'), 'replace');
  _t.write(is_html ? decodeURIComponent(data) : '<pre>' + decodeURIComponent(data) + '</pre>');
  _t.close();
}

// --- Encoding Definitions & Initialization ---
// This function is called at service worker startup and ensures ENCODINGS is populated.
async function initializeEncodings() {
  const result = await chrome.storage.local.get(['recent']);
  recentlySelectedEncodingList = (result.recent || '').split(',').filter(e => e);

  ENCODINGS = [
    ['<hr>'],
    ['Big5', chrome.i18n.getMessage('encodingChineseTraditional')],
    ['GBK', chrome.i18n.getMessage('encodingChineseSimplified')],
    ['GB18030', chrome.i18n.getMessage('encodingChineseSimplified')],
    ['EUC-JP', chrome.i18n.getMessage('encodingJapanese')],
    ['EUC-KR', chrome.i18n.getMessage('encodingKorean')],
    ['IBM866', chrome.i18n.getMessage('encodingCyrillic')],
    ['ISO-2022-JP', chrome.i18n.getMessage('encodingJapanese')],
    ['ISO-8859-2', chrome.i18n.getMessage('encodingCentralEuropean')],
    ['ISO-8859-3', chrome.i18n.getMessage('encodingSouthEuropean')],
    ['ISO-8859-4', chrome.i18n.getMessage('encodingBaltic')],
    ['ISO-8859-5', chrome.i18n.getMessage('encodingCyrillic')],
    ['ISO-8859-6', chrome.i18n.getMessage('encodingArabic')],
    ['ISO-8859-7', chrome.i18n.getMessage('encodingGreek')],
    ['ISO-8859-8', chrome.i18n.getMessage('encodingHebrew')],
    ['ISO-8859-8-I', chrome.i18n.getMessage('encodingHebrew')],
    ['ISO-8859-10', chrome.i18n.getMessage('encodingNordic')],
    ['ISO-8859-13', chrome.i18n.getMessage('encodingBaltic')],
    ['ISO-8859-14', chrome.i18n.getMessage('encodingCeltic')],
    ['ISO-8859-15', chrome.i18n.getMessage('encodingWestern')],
    ['ISO-8859-16', chrome.i18n.getMessage('encodingRomanian')],
    ['KOI8-R', chrome.i18n.getMessage('encodingCyrillic')],
    ['KOI8-U', chrome.i18n.getMessage('encodingCyrillic')],
    ['Macintosh', chrome.i18n.getMessage('encodingWestern')],
    ['Shift_JIS', chrome.i18n.getMessage('encodingJapanese')],
    ['UTF-8', chrome.i18n.getMessage('encodingUnicode')],
    ['UTF-16LE', chrome.i18n.getMessage('encodingUnicode')],
    ['Windows-874', chrome.i18n.getMessage('encodingThai')],
    ['Windows-1250', chrome.i18n.getMessage('encodingCentralEuropean')],
    ['Windows-1251', chrome.i18n.getMessage('encodingCyrillic')],
    ['Windows-1252', chrome.i18n.getMessage('encodingWestern')],
    ['Windows-1253', chrome.i18n.getMessage('encodingGreek')],
    ['Windows-1254', chrome.i18n.getMessage('encodingTurkish')],
    ['Windows-1255', chrome.i18n.getMessage('encodingHebrew')],
    ['Windows-1256', chrome.i18n.getMessage('encodingArabic')],
    ['Windows-1257', chrome.i18n.getMessage('encodingBaltic')],
    ['Windows-1258', chrome.i18n.getMessage('encodingVietnamese')],
  ].sort(([a, nameA], [b, nameB]) => {
    if (a === 'UTF-8') return -1;
    if (b === 'UTF-8') return 1;
    {
      const hasA = LocaleDependentStaticEncodingList.indexOf(a);
      const hasB = LocaleDependentStaticEncodingList.indexOf(b);
      if (hasA >= 0 && hasB >= 0) return hasA > hasB ? 1 : -1;
      if (hasA >= 0) return -1;
      if (hasB >= 0) return 1;
    }
    {
      const hasA = recentlySelectedEncodingList.indexOf(a);
      const hasB = recentlySelectedEncodingList.indexOf(b);
      if (hasA >= 0 && hasB >= 0) return hasA > hasB ? 1 : -1;
      if (hasA >= 0) return -1;
      if (hasB >= 0) return 1;
    }
    if (a === '<hr>') return -1;
    if (b === '<hr>') return 1;
    if (a === 'UTF-16LE') return -1;
    if (b === 'UTF-16LE') return 1;
    return nameA.localeCompare(nameB, chrome.i18n.getUILanguage());
  });
}

// --- Core Logic Functions (Adapted from background.js and menu.js) ---

async function recordRecentlySelectedEncoding(encoding) {
  let { recent } = await chrome.storage.local.get(['recent']);
  const recentList = (recent || '')
    .split(',')
    .filter(e => e && e !== encoding)
    .slice(0, 2);
  await chrome.storage.local.set({ 'recent': [encoding, ...recentList].join(',') });
  // Re-initialize ENCODINGS to reflect the new recent list for the menu
  await initializeEncodings();
}

// bodyModifier for file:// URLs using scripting API - DNR does not apply to file://
async function bodyModifier(tabId, changeInfo, tab) {
  if (!tab.url || !tab.url.toLowerCase().startsWith('file://')) {
    return;
  }
  if (changeInfo.status && changeInfo.status.toLowerCase() !== 'complete') {
    return;
  }
  const effectiveEncoding = encodingList.get(tabId) || defaultEncoding;
  if (!effectiveEncoding) {
    return;
  }

  try {
    const response = await fetch(tab.url);
    const arrayBuffer = await response.arrayBuffer();
    const decoder = new TextDecoder(effectiveEncoding);
    const decodedText = decoder.decode(arrayBuffer);

    await chrome.storage.local.remove(['alertedCannotLoadLocalFile']);
    const is_html = /\.html?$/.test(tab.url);
    const dataForInjection = is_html ? encodeURIComponent(decodedText) : encodeURIComponent(html_special_chars(decodedText));

    await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: stringToFunc,
        args: [is_html, dataForInjection],
        world: 'MAIN'
    });

  } catch (e) {
    console.error("Failed to fetch, decode, or execute script for bodyModifier:", e);
    try {
        let { alertedCannotLoadLocalFile } = await chrome.storage.local.get(['alertedCannotLoadLocalFile']);
        if (!alertedCannotLoadLocalFile) {
            await chrome.storage.local.set({ 'alertedCannotLoadLocalFile': '1' });
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'i/128.png',
                title: chrome.i18n.getMessage('appName'),
                message: chrome.i18n.getMessage('cannotLoadLocalFile') + "\n" + chrome.i18n.getMessage('ensureExtensionAccessToFileURLs')
            });
        }
    } catch (alertError) {
        console.error("Error showing notification for local file loading issue:", alertError);
    }
  }
}

async function setEncoding(tabId, encoding) {
  encodingList.set(tabId, encoding);
  await recordRecentlySelectedEncoding(encoding);

  const oldRuleId = tabRuleIds.get(tabId);
  const removeRuleIds = oldRuleId ? [oldRuleId] : [];

  const newRuleId = nextDynamicRuleId++;
  const newRule = {
    id: newRuleId,
    priority: 2,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [{
        header: 'Content-Type',
        operation: 'set',
        value: `text/plain; charset=${encoding}`
      }]
    },
    condition: {
      tabIds: [tabId],
      resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'xmlhttprequest']
    }
  };

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: removeRuleIds,
      addRules: [newRule]
    });
    tabRuleIds.set(tabId, newRuleId);
    console.log(`[Service Worker] DNR rule ${newRuleId} set for tab ${tabId} with encoding ${encoding}. Old rule ${oldRuleId} removed.`);
  } catch (e) {
    console.error(`[Service Worker] Error setting DNR rule for tab ${tabId}:`, e);
  }
}

async function resetEncoding(tabId) {
  encodingList.delete(tabId);
  const ruleIdToRemove = tabRuleIds.get(tabId);

  if (ruleIdToRemove) {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleIdToRemove]
      });
      tabRuleIds.delete(tabId);
      console.log(`[Service Worker] DNR rule ${ruleIdToRemove} removed for tab ${tabId}.`);
    } catch (e) {
      console.error(`[Service Worker] Error removing DNR rule for tab ${tabId}:`, e);
    }
  }
}

function getEncoding(tabId) {
  return encodingList.get(tabId) || defaultEncoding;
}

async function setupDefaultEncoding() {
  const result = await chrome.storage.local.get(['config_enable_default']);
  const newDefaultEncoding = result.config_enable_default;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [DEFAULT_ENCODING_RULE_ID]
    });
    console.log(`[Service Worker] Old default DNR rule ${DEFAULT_ENCODING_RULE_ID} (if existed) removed.`);
  } catch (e) {
    console.error(`[Service Worker] Error removing default DNR rule ${DEFAULT_ENCODING_RULE_ID}:`, e);
  }

  defaultEncoding = newDefaultEncoding;

  if (defaultEncoding) {
    const defaultRule = {
      id: DEFAULT_ENCODING_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [{
          header: 'Content-Type',
          operation: 'set',
          value: `text/plain; charset=${defaultEncoding}`
        }]
      },
      condition: {
        resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'xmlhttprequest']
      }
    };
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [defaultRule]
      });
      console.log(`[Service Worker] Default DNR rule ${DEFAULT_ENCODING_RULE_ID} set for encoding ${defaultEncoding}.`);
    } catch (e) {
      console.error(`[Service Worker] Error setting default DNR rule ${DEFAULT_ENCODING_RULE_ID}:`, e);
    }
  } else {
    console.log(`[Service Worker] Default encoding is not set. No default DNR rule added.`);
  }
}

async function unsetDefaultEncoding() {
  defaultEncoding = undefined;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [DEFAULT_ENCODING_RULE_ID]
    });
    console.log(`[Service Worker] Default DNR rule ${DEFAULT_ENCODING_RULE_ID} removed due to unsetDefaultEncoding.`);
  } catch (e) {
    console.error(`[Service Worker] Error removing default DNR rule ${DEFAULT_ENCODING_RULE_ID} during unset:`, e);
  }
}

// --- Menu Functions ---
async function menuClicked(info, tab) {
  if (!tab) {
    console.warn("menuClicked called without tab info.");
    return;
  }
  if (ENCODINGS.length === 0) {
    await initializeEncodings();
  }

  if (info.wasChecked && info.menuItemId !== 'default') {
    return;
  }

  if (info.menuItemId === 'default') {
    await resetEncoding(tab.id);
  } else {
    await setEncoding(tab.id, info.menuItemId);
  }

  try {
    const currentEffectiveEncoding = getEncoding(tab.id);
    if (info.menuItemId !== currentEffectiveEncoding || (info.menuItemId === 'default' && encodingList.has(tab.id)) ) {
        await chrome.tabs.reload(tab.id, { bypassCache: true });
    } else {
        updateMenu(tab.id);
    }
  } catch (e) {
    console.error("Error reloading tab or updating menu:", e);
  }
}

async function updateMenu(tabId) {
  if (!chrome.contextMenus || !chrome.contextMenus.update) {
    return;
  }
  if (ENCODINGS.length === 0) {
    await initializeEncodings();
  }
  const effectiveEncoding = getEncoding(tabId) || 'default';
  if (selectedMenu === effectiveEncoding) {
    return;
  }
  if (selectedMenu) {
    try {
      await chrome.contextMenus.update(selectedMenu, { checked: false });
    } catch (e) {
      // Ignore error if menu item was already removed or doesn't exist
    }
  }
  try {
    await chrome.contextMenus.update(effectiveEncoding, { checked: true });
    selectedMenu = effectiveEncoding;
  } catch (e) {
    const { config_menu } = await chrome.storage.local.get(['config_menu']);
    if (config_menu === 'true') {
        console.log("Attempting to recreate menu due to update error for item:", effectiveEncoding, e);
        await createMenuInternal(true); // Force recreate
    }
  }
}

const tabUpdatedListener = (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        updateMenu(tabId);
    }
    if (tab && tab.url && tab.url.toLowerCase().startsWith('file://') && changeInfo.status === 'complete') {
        bodyModifier(tabId, changeInfo, tab);
    }
};

const tabActivatedListener = activeInfo => {
  updateMenu(activeInfo.tabId);
};

const windowsFocusedListener = async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      updateMenu(tab.id);
    }
  } catch (e) {
    console.error("Error querying active tab on window focus:", e);
  }
};

let menuCreationInProgress = false;
async function createMenuInternal(forceRecreate = false) {
    if (menuCreationInProgress && !forceRecreate) return;
    menuCreationInProgress = true;

    try {
        await chrome.contextMenus.removeAll();
    } catch (e) {
      // console.warn("Error removing all context menus:", e);
    }
    
    if (ENCODINGS.length === 0) {
        await initializeEncodings();
    }

    try {
        await chrome.contextMenus.create({
            type: 'radio',
            id: 'default',
            title: chrome.i18n.getMessage('default') || 'Default',
            checked: true,
        });
        selectedMenu = 'default';

        for (const encoding of ENCODINGS) {
            if (encoding.length === 1) {
                continue;
            }
            await chrome.contextMenus.create({
                type: 'radio',
                id: encoding[0],
                title: printEncodingInfo(encoding),
                checked: false,
            });
        }
    } catch (e) {
        console.error("Error creating context menu items:", e);
    } finally {
        menuCreationInProgress = false;
    }
}


async function createMenu() {
  if (ENCODINGS.length === 0) {
    await initializeEncodings();
  }
  await createMenuInternal();

  chrome.tabs.onUpdated.addListener(tabUpdatedListener);
  chrome.tabs.onActivated.addListener(tabActivatedListener);
  chrome.windows.onFocusChanged.addListener(windowsFocusedListener);
}

async function removeMenu() {
  await chrome.contextMenus.removeAll();
  chrome.tabs.onUpdated.removeListener(tabUpdatedListener);
  chrome.tabs.onActivated.removeListener(tabActivatedListener);
  chrome.windows.onFocusChanged.removeListener(windowsFocusedListener);
  selectedMenu = undefined;
}


// --- Event Listeners Registration ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch(message.type) {
      case 'setEncoding':
        if (sender.tab && sender.tab.id && message.encoding) {
          await setEncoding(sender.tab.id, message.encoding);
          sendResponse({status: "Encoding set"});
        } else {
          sendResponse({status: "Error: Missing tabId or encoding"});
        }
        break;
      case 'resetEncoding':
        if (sender.tab && sender.tab.id) {
          await resetEncoding(sender.tab.id);
          sendResponse({status: "Encoding reset"});
        } else {
          sendResponse({status: "Error: Missing tabId"});
        }
        break;
      case 'getEncoding':
        if (sender.tab && sender.tab.id) {
          const encoding = getEncoding(sender.tab.id);
          sendResponse({encoding: encoding});
        } else {
          sendResponse({status: "Error: Missing tabId"});
        }
        break;
      case 'getEncodings':
        if (ENCODINGS && ENCODINGS.length > 0) {
          sendResponse(ENCODINGS);
        } else {
          console.warn("getEncodings message received, but ENCODINGS not ready. Initializing...");
          await initializeEncodings();
          sendResponse(ENCODINGS);
        }
        break;
      case 'createMenu':
        await removeMenu();
        await createMenu();
        sendResponse({status: "Menu created/recreated"});
        break;
      case 'removeMenu':
        await removeMenu();
        sendResponse({status: "Menu removed"});
        break;
      case 'setupDefaultEncoding':
        await setupDefaultEncoding();
        sendResponse({status: "Default encoding setup"});
        break;
      case 'unsetDefaultEncoding':
        await unsetDefaultEncoding();
        sendResponse({status: "Default encoding unset"});
        break;
      default:
        sendResponse({status: "Unknown message type"});
        break;
    }
  })();
  return true; // Required for async sendResponse
});

chrome.contextMenus.onClicked.addListener(menuClicked);

chrome.tabs.onRemoved.addListener(async (tabId) => {
    await resetEncoding(tabId);
    console.log(`[Service Worker] Cleaned up encoding state and DNR rule for removed tab ${tabId}`);
});


// --- Initial Setup ---
(async () => {
  try {
    const currentRules = await chrome.declarativeNetRequest.getSessionRules();
    const ruleIdsToRemove = currentRules.map(rule => rule.id);
    if (ruleIdsToRemove.length > 0) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIdsToRemove });
      console.log('[Service Worker] Cleared existing session DNR rules on startup/reload.');
    }
  } catch (e) {
    console.error('[Service Worker] Error clearing existing session DNR rules:', e);
  }
  
  try {
    const sessionRules = await chrome.declarativeNetRequest.getSessionRules();
    nextDynamicRuleId = sessionRules.reduce((maxId, rule) => Math.max(maxId, rule.id), DEFAULT_ENCODING_RULE_ID) + 1;
  } catch(e) {
     console.error('[Service Worker] Error getting session DNR rules for nextDynamicRuleId init:', e);
     nextDynamicRuleId = DEFAULT_ENCODING_RULE_ID +1; // Fallback
  }


  await initializeEncodings();
  await setupDefaultEncoding();
  const { config_menu } = await chrome.storage.local.get(['config_menu']);
  if (config_menu === 'true') {
    await createMenu();
  }

  chrome.management.onSelfEnabled.addListener(async (info) => {
    if (info.hostPermissions && info.hostPermissions.includes("file:///*")) {
        console.log("Extension now has file URL access.");
    }
  });
  
  console.log('Service worker initialized.');
})();
