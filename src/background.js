// Background script for Sticky Bear extension

// Function to update the badge with the number of notes
async function updateBadge() {
  try {
    const result = await chrome.storage.sync.get(['stickyNotes']);
    const notes = result.stickyNotes || [];
    const noteCount = notes.length;

    // Set badge text
    const badgeText = noteCount > 0 ? noteCount.toString() : '';
    await chrome.action.setBadgeText({ text: badgeText });

    // Set badge background color
    await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } catch (error) {
    console.error('Error updating badge:', error);
  }
}

chrome.action.onClicked.addListener((tab) => {
  // Open the side panel when the action button is clicked
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Handle keyboard shortcut commands
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab) return;

  if (command === 'add-note') {
    // Open the side panel and send a message to add a new note
    chrome.sidePanel.open({ windowId: tab.windowId }).then(() => {
      // Send message to the side panel to add a new note
      chrome.runtime.sendMessage({ action: 'add-note' });
    });
  }
});

// Handle messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'update-badge') {
    updateBadge();
  }
});

// Listen for storage changes to update badge
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.stickyNotes) {
    updateBadge();
  }
});

// Set up side panel behavior on installation
chrome.runtime.onInstalled.addListener(() => {
  // Enable the side panel on all sites
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Initialize badge on installation
  updateBadge();

  // Install header modification rules to allow most pages in iframes
  chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          condition: {
            urlFilter: '*',
            resourceTypes: [
              'sub_frame',
              'xmlhttprequest',
              'websocket',
              'main_frame',
              'other',
            ],
          },
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'X-Frame-Options', operation: 'remove' },
              { header: 'Frame-Options', operation: 'remove' },
              { header: 'Content-Security-Policy', operation: 'remove' },
              {
                header: 'Content-Security-Policy-Report-Only',
                operation: 'remove',
              },
            ],
          },
        },
      ],
    })
    .catch((_e) => {});
});

// Update badge when extension starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Inject small spoofing to reduce some blockers within frames
const injectWindowSpoofing = async (tabId, frameId) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      injectImmediately: true,
      // @ts-ignore args is supported
      args: [chrome.runtime.id],
      func: (extensionId) => {
        try {
          if (!window['__STICKY_BEAR_EXTENSION_ID']) {
            Object.defineProperty(window, '__STICKY_BEAR_EXTENSION_ID', {
              value: String(extensionId),
              configurable: false,
              enumerable: false,
              writable: false,
            });
          }
          const originalStop = window.stop;
          const originalWrite = document.write;
          window.stop = () => {};
          document.write = (content) => {
            if (content === '') return;
            originalWrite(content);
          };
        } catch (_e) {}
      },
    });
  } catch (_e) {}
};

chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId >= 0) {
      injectWindowSpoofing(details.tabId, details.frameId);
    }
  },
  { url: [{ schemes: ['http', 'https'] }] },
);

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId >= 0) {
      injectWindowSpoofing(details.tabId, details.frameId);
    }
  },
  { url: [{ schemes: ['http', 'https'] }] },
);
