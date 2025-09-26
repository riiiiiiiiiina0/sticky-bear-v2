// Background script for Sticky Bear extension

// Queue for pending messages to side panel
let pendingMessages = [];
let sidePanelReady = false;

// Function to create context menus
function createContextMenus() {
  try {
    // Remove any existing context menus first
    chrome.contextMenus.removeAll();

    // Context menu for pages
    chrome.contextMenus.create({
      id: 'sticky-bear-add-page',
      title: 'Add page as sticky note',
      contexts: ['page'],
    });

    // Context menu for links
    chrome.contextMenus.create({
      id: 'sticky-bear-add-link',
      title: 'Add link as sticky note',
      contexts: ['link'],
    });
  } catch (error) {
    console.error('Error creating context menus:', error);
  }
}

// Function to send message to side panel (with queuing if not ready)
function sendToSidePanel(message) {
  if (sidePanelReady) {
    chrome.runtime.sendMessage(message).catch((error) => {
      console.log('Side panel not ready, queuing message:', error);
      pendingMessages.push(message);
      sidePanelReady = false;
    });
  } else {
    pendingMessages.push(message);
  }
}

// Function to send message with timeout fallback
function sendToSidePanelWithFallback(message) {
  sendToSidePanel(message);

  // Fallback: if message isn't processed within 500ms, try sending directly
  // This handles the case where side panel is open but ready signal was missed
  setTimeout(() => {
    const messageIndex = pendingMessages.findIndex(
      (msg) => msg.action === message.action && msg.url === message.url,
    );

    if (messageIndex !== -1) {
      // Remove from pending queue and send directly
      pendingMessages.splice(messageIndex, 1);
      chrome.runtime.sendMessage(message).catch((error) => {
        console.log('Fallback message send failed, re-queuing:', error);
        // Put it back in queue if direct send fails
        pendingMessages.push(message);
      });
    }
  }, 500);
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;

  let url = '';
  if (info.menuItemId === 'sticky-bear-add-page') {
    url = info.pageUrl || tab.url || '';
  } else if (info.menuItemId === 'sticky-bear-add-link') {
    url = info.linkUrl || '';
  }

  if (url) {
    // Open the side panel
    chrome.sidePanel.open({ windowId: tab.windowId }).then(() => {
      // Send the message with fallback for when panel is already open
      sendToSidePanelWithFallback({
        action: 'add-url-note-with-url',
        url: url,
      });
    });
  }
});

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

// Function to handle iframe data updates from content scripts
async function handleIframeDataUpdate(message) {
  try {
    const { noteId, url, data } = message;

    // Get current notes from storage
    const result = await chrome.storage.sync.get(['stickyNotes', 'iframeData']);
    const notes = result.stickyNotes || [];
    const iframeData = result.iframeData || {};

    // Find the note that this iframe belongs to
    const note = notes.find((n) => n.id === noteId);
    if (!note) {
      console.warn('Note not found for iframe data update:', noteId);
      return;
    }

    // Ensure the iframe data object exists for this note
    if (!iframeData[noteId]) {
      iframeData[noteId] = {};
    }

    // Update iframe data based on the type of update
    const noteIframeData = iframeData[noteId];

    switch (data.type) {
      case 'page-load':
      case 'title-change':
        noteIframeData.title = data.title;
        noteIframeData.lastUrl = data.url;
        noteIframeData.lastUpdated = data.timestamp;
        break;

      case 'scroll-change':
        noteIframeData.scrollX = data.scrollX;
        noteIframeData.scrollY = data.scrollY;
        noteIframeData.lastScrollUpdate = data.timestamp;
        break;

      case 'url-change':
        noteIframeData.lastUrl = data.url;
        noteIframeData.title = data.title;
        noteIframeData.lastUpdated = data.timestamp;
        break;

      case 'page-unload':
        // Save final state on unload
        noteIframeData.scrollX = data.scrollX;
        noteIframeData.scrollY = data.scrollY;
        noteIframeData.lastUrl = data.url;
        noteIframeData.title = data.title;
        noteIframeData.lastUpdated = data.timestamp;
        break;
    }

    // Save updated iframe data
    await chrome.storage.sync.set({ iframeData });

    // Forward the update to the side panel if it's ready
    if (sidePanelReady) {
      chrome.runtime
        .sendMessage({
          action: 'iframe-data-updated',
          noteId,
          data: noteIframeData,
        })
        .catch(() => {
          // Side panel might not be ready to receive the message
        });
    }
  } catch (error) {
    console.error('Error handling iframe data update:', error);
  }
}

// Function to handle requests for iframe state restoration
async function handleGetIframeState(message, sendResponse) {
  try {
    const { noteId } = message;

    // Get iframe data from storage
    const result = await chrome.storage.sync.get(['iframeData']);
    const iframeData = result.iframeData || {};

    const noteIframeData = iframeData[noteId] || {};

    sendResponse({
      success: true,
      data: noteIframeData,
    });
  } catch (error) {
    console.error('Error getting iframe state:', error);
    sendResponse({
      success: false,
      error: error.message,
    });
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
      sendToSidePanelWithFallback({ action: 'add-note' });
    });
  } else if (command === 'add-url-note') {
    // Open the side panel and send a message to add a new URL note
    chrome.sidePanel.open({ windowId: tab.windowId }).then(() => {
      // Send message to the side panel to add a new URL note
      sendToSidePanelWithFallback({ action: 'add-url-note' });
    });
  }
});

// Handle messages from the side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'update-badge') {
    updateBadge();
  } else if (message.action === 'sidepanel-ready') {
    sidePanelReady = true;

    // Send all pending messages
    const messagesToSend = [...pendingMessages];
    pendingMessages = [];

    for (const pendingMessage of messagesToSend) {
      chrome.runtime.sendMessage(pendingMessage).catch((error) => {
        console.error('Error sending pending message:', error);
        // If sending fails, the side panel might not be ready after all
        sidePanelReady = false;
        // Put the message back in the queue
        pendingMessages.push(pendingMessage);
      });
    }
  } else if (message.action === 'iframe-data-update') {
    // Handle iframe data updates from content scripts
    handleIframeDataUpdate(message);
  } else if (message.action === 'get-iframe-state') {
    // Handle requests for iframe state restoration
    handleGetIframeState(message, sendResponse);
    return true; // Keep the message channel open for async response
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

  // Create context menus
  createContextMenus();

  // Install header modification rules to allow most pages in iframes
  chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [1, 2],
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
        {
          id: 2,
          priority: 1,
          condition: {
            resourceTypes: ['sub_frame'],
          },
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              {
                header: 'user-agent',
                operation: 'set',
                value:
                  'Mozilla/5.0 (iPhone; CPU iPhone OS 13_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Mobile/15E148 Safari/604.1',
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
