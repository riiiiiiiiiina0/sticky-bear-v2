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
});

// Update badge when extension starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});
