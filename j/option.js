/**
 * Created by Liming on 2019/3/2.
 */
const rtl = chrome.i18n.getMessage('@@bidi_dir') === 'rtl' ? '&rlm;' : '';
const printEncodingInfo = info => `${info[1]} ${rtl}(${info[0]})`;

(async () => { // Wrap in async IIFE
  const ENCODINGS = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'getEncodings' }, resolve));
  if (!ENCODINGS || ENCODINGS.length === 0) {
    console.error("Failed to load encodings from service worker for options page or ENCODINGS is empty.");
    document.body.innerHTML = "Error: Could not load encodings for options page."; // Or some other user-friendly error
    return;
  }

  // I18n
  document.getElementById('menu').innerHTML = chrome.i18n.getMessage('optionMenu');
  document.getElementById('default-encoding').innerHTML = chrome.i18n.getMessage('optionDefaultEncoding');

  // Initialize encoding list
  const list = document.getElementById('default-encoding-list');
  let option = document.createElement('option');
  option.value = '';
  option.innerHTML = chrome.i18n.getMessage('default');
  list.appendChild(option);

  const optgroup = [
    document.createElement('optgroup'), // For UTF-8, locale-dependent, recent
    document.createElement('optgroup'), // For others
  ];
  optgroup[0].label = chrome.i18n.getMessage('optionRecommendEncoding');
  optgroup[1].label = chrome.i18n.getMessage('optionOtherEncoding');
  
  let currentOptGroupIndex = 0; // Start with the "Recommend" group
  for (const encodingInfo of ENCODINGS) {
    if (encodingInfo.length === 1 && encodingInfo[0] === '<hr>') {
      // When <hr> is encountered, switch to the "Other" optgroup if not already there.
      currentOptGroupIndex = 1; 
      continue;
    }
    if (encodingInfo.length > 1) { // Ensure it's a valid encoding entry
        option = document.createElement('option');
        option.value = encodingInfo[0];
        option.innerHTML = printEncodingInfo(encodingInfo);
        optgroup[currentOptGroupIndex].appendChild(option);
    }
  }
  optgroup.forEach(o => {
    if (o.childNodes.length > 0) { // Only append optgroup if it has options
        list.appendChild(o);
    }
  });

  // Current Setting
  const contextMenuButton = document.getElementById('context-menu');
  if (contextMenuButton instanceof HTMLInputElement) {
    const menuConfig = await chrome.storage.local.get('config_menu');
    contextMenuButton.checked = (menuConfig.config_menu === 'true');
  }
  if (list instanceof HTMLSelectElement) {
    const defaultEncConfig = await chrome.storage.local.get('config_enable_default');
    list.value = defaultEncConfig.config_enable_default || '';
  }

  // Fix RTL mode display
  if (rtl) {
    list.style.backgroundPosition = '8px';
  }

  // Change Events
  document.body.addEventListener('change', async e => { // Make listener async
    if (e.target instanceof HTMLInputElement) {
      if (e.target.id === 'context-menu') {
        if (e.target.checked) {
          await chrome.storage.local.set({ config_menu: 'true' });
          chrome.runtime.sendMessage({ type: 'createMenu' });
        } else {
          await chrome.storage.local.remove('config_menu');
          chrome.runtime.sendMessage({ type: 'removeMenu' });
        }
        return;
      }
    }
    if (e.target instanceof HTMLSelectElement) {
      if (e.target.id === 'default-encoding-list') {
        if (e.target.value) {
          await chrome.storage.local.set({ config_enable_default: e.target.value });
          chrome.runtime.sendMessage({ type: 'setupDefaultEncoding' });
        } else {
          await chrome.storage.local.remove('config_enable_default');
          chrome.runtime.sendMessage({ type: 'unsetDefaultEncoding' });
        }
        return;
      }
    }
  });
})();
