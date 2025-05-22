/**
 * Created by Liming on 2017/2/14.
 */
const rtl = chrome.i18n.getMessage('@@bidi_dir') === 'rtl' ? '&rlm;' : '';
const printEncodingInfo = info => `${info[1]} ${rtl}(${info[0]})`;

const distance = (x1, y1, x2, y2) => {
  var xDelta = x1 - x2;
  var yDelta = y1 - y2;
  return Math.sqrt(xDelta * xDelta + yDelta * yDelta);
};

(async () => { // Wrap in async IIFE to use await
  const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
  if (tabs.length === 0) {
    return;
  }

  const ENCODINGS = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'getEncodings' }, resolve));
  if (!ENCODINGS || ENCODINGS.length === 0) {
    console.error("Failed to load encodings from service worker or ENCODINGS is empty.");
    document.getElementById('current').innerHTML = chrome.i18n.getMessage('unknown');
    const listElement = document.getElementById('list');
    if(listElement) listElement.innerHTML = "Error: Could not load encodings list.";
    return;
  }

  // Detect current encoding
  const currentDOM = document.getElementById('current');
  currentDOM.innerHTML = '......';

  const tab = tabs[0];
  // Try to get effective encoding from service worker first (covers file:// and default encoding cases)
  const effectiveEncodingResponse = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'getEncoding', tabId: tab.id }, resolve));
  const effectiveEncoding = effectiveEncodingResponse ? effectiveEncodingResponse.encoding : null;

  if (effectiveEncoding) {
    const encodingInfo = ENCODINGS.find(e => e.length > 1 && e[0].toUpperCase() === effectiveEncoding.toUpperCase());
    currentDOM.innerHTML = encodingInfo ? printEncodingInfo(encodingInfo) : printEncodingInfo([effectiveEncoding, chrome.i18n.getMessage('unknown')]);
  } else if (tab.url && !tab.url.startsWith('file://') && !tab.url.startsWith('chrome://')) {
    try {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.charset,
      }, (injectionResults) => {
        if (chrome.runtime.lastError) {
          console.warn('Error executing script: ' + chrome.runtime.lastError.message);
          currentDOM.innerHTML = chrome.i18n.getMessage('unknown');
          return;
        }
        // executeScript returns an array of results, one for each frame. We're interested in the main frame (index 0).
        if (!injectionResults || injectionResults.length === 0 || !injectionResults[0].result) {
          currentDOM.innerHTML = chrome.i18n.getMessage('unknown');
          return;
        }
        const pageCharset = injectionResults[0].result;
        const encodingInfo = ENCODINGS.find(e => e.length > 1 && e[0].toUpperCase() === String(pageCharset).toUpperCase());
        currentDOM.innerHTML = printEncodingInfo(encodingInfo || [pageCharset, chrome.i18n.getMessage('unknown')]);
      });
    } catch (e) {
        currentDOM.innerHTML = chrome.i18n.getMessage('unknown');
        console.warn('Error calling executeScript to get document.charset:', e.message);
    }
  } else {
    currentDOM.innerHTML = chrome.i18n.getMessage('unknown');
  }

  // I18n
  document.getElementById('reset').innerHTML = chrome.i18n.getMessage('btnReset');
  document.getElementById('tip-current').innerHTML = chrome.i18n.getMessage('tipCurrent');

  // Setted default encoding
  const storageResult = await chrome.storage.local.get('config_enable_default');
  const defaultEncodingSetting = storageResult.config_enable_default;

  if (defaultEncodingSetting) {
    const encodingInfo = ENCODINGS.find(e => e.length > 1 && e[0].toUpperCase() === defaultEncodingSetting.toUpperCase());
    if (encodingInfo) {
        const defaultTip = document.getElementById('default-tip');
        defaultTip.innerHTML = chrome.i18n.getMessage('defaultEncodingEnabled', [printEncodingInfo(encodingInfo)]);
        defaultTip.title = chrome.i18n.getMessage('tipDisableDefaultEncoding');
        defaultTip.addEventListener('click', () => chrome.runtime.openOptionsPage());
    }
  }

  // Reset button
  document.getElementById('reset').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'resetEncoding', tabId: tab.id }, () => {
      chrome.tabs.reload(tab.id, { bypassCache: true }, () => window.close());
    });
  });

  // Initialize encoding list
  const listElement = document.getElementById('list');
  listElement.addEventListener('click', e => {
    if(!(e.target instanceof HTMLButtonElement && e.target.dataset.encoding)) {
      return;
    }
    chrome.runtime.sendMessage({ type: 'setEncoding', tabId: tab.id, encoding: e.target.dataset.encoding }, () => {
      chrome.tabs.reload(tab.id, { bypassCache: true }, () => window.close());
    });
  });

  for (const encodingInfo of ENCODINGS) {
    if (encodingInfo.length === 1) { // This is for '<hr>'
      listElement.appendChild(document.createElement('hr'));
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.encoding = encodingInfo[0];
    button.innerHTML = printEncodingInfo(encodingInfo);
    listElement.appendChild(button);
  }

  // Ripple animate event
  let inks = [];
  const removeInks = () => {
    for (const ink of inks) {
      if (ink.parentElement) {
        ink.parentElement.removeChild(ink);
      }
    }
    inks = [];
  };
  document.body.addEventListener('mousedown', e => {
    removeInks();
    if (!(e && e.target instanceof HTMLButtonElement)) {
      return;
    }
    const rect = e.target.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    const cornerDistances = [
      { x: 0, y: 0 },
      { x: rect.width, y: 0 },
      { x: 0, y: rect.height },
      { x: rect.width, y: rect.height },
    ].map(corner => Math.round(distance(x, y, corner.x, corner.y)));
    const radius = Math.max(...cornerDistances);
    const startTranslate = `${x - radius}px, ${y - radius}px`;
    const ripple = document.createElement('div');
    ripple.classList.add('ripple');
    ripple.style.height = ripple.style.width = `${2 * radius}px`;
    const ink = document.createElement('div');
    ink.classList.add('ink');
    ink.appendChild(ripple);
    e.target.appendChild(ink);
    const duration = Math.max(800, Math.log(radius) * radius);
    ripple.animate({
      transform: [
        `translate(${startTranslate}) scale(0)`,
        `translate(${startTranslate}) scale(1)`,
      ],
    }, {
      duration,
      easing: 'cubic-bezier(.2, .9, .1, .9)',
      fill: 'forwards',
    });
    inks.push(ink);
  });
  document.body.addEventListener('mouseup', removeInks);
})();
