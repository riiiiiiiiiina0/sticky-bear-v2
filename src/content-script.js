// Content script for monitoring page title and scroll position in iframes
// This script gets injected into iframe pages to track their state

(function () {
  'use strict';

  // Check if we're in a Sticky Bear iframe
  if (!window.parent || window === window.top) {
    return; // Only run in iframes
  }

  // Check if this content script has already been injected
  if (window['__STICKY_BEAR_CONTENT_SCRIPT_LOADED']) {
    return;
  }
  window['__STICKY_BEAR_CONTENT_SCRIPT_LOADED'] = true;

  let noteId = null;
  let lastTitle = '';
  let lastScrollY = 0;
  let lastScrollX = 0;
  let isThrottling = false;

  // Function to get the note ID from the iframe's name attribute
  function getNoteId() {
    if (noteId) return noteId;

    try {
      // The iframe name is set as 'sbp-iframe-{noteId}' in the main script
      const iframeName = window.name;
      if (iframeName && iframeName.startsWith('sbp-iframe-')) {
        noteId = iframeName.replace('sbp-iframe-', '');
        return noteId;
      }
    } catch (e) {
      console.debug('Could not get iframe name:', e);
    }

    return null;
  }

  // Function to send data to the extension
  function sendToExtension(data) {
    const currentNoteId = getNoteId();
    if (!currentNoteId) return;

    try {
      // Send message to the extension background script
      chrome.runtime.sendMessage({
        action: 'iframe-data-update',
        noteId: currentNoteId,
        url: window.location.href,
        data: data,
      });
    } catch (e) {
      console.debug('Failed to send message to extension:', e);
    }
  }

  // Function to get current page data
  function getCurrentPageData() {
    return {
      title: document.title,
      scrollX: Math.round(window.scrollX || window.pageXOffset || 0),
      scrollY: Math.round(window.scrollY || window.pageYOffset || 0),
      timestamp: Date.now(),
      url: window.location.href,
    };
  }

  // Function to handle title changes
  function handleTitleChange() {
    const currentTitle = document.title;
    if (currentTitle !== lastTitle) {
      lastTitle = currentTitle;
      sendToExtension({
        type: 'title-change',
        ...getCurrentPageData(),
      });
    }
  }

  // Throttled scroll handler
  function handleScroll() {
    if (isThrottling) return;

    isThrottling = true;
    requestAnimationFrame(() => {
      const currentScrollX = Math.round(
        window.scrollX || window.pageXOffset || 0,
      );
      const currentScrollY = Math.round(
        window.scrollY || window.pageYOffset || 0,
      );

      // Only send if scroll position changed significantly (more than 5 pixels)
      if (
        Math.abs(currentScrollX - lastScrollX) > 5 ||
        Math.abs(currentScrollY - lastScrollY) > 5
      ) {
        lastScrollX = currentScrollX;
        lastScrollY = currentScrollY;

        sendToExtension({
          type: 'scroll-change',
          ...getCurrentPageData(),
        });
      }

      isThrottling = false;
    });
  }

  // Function to restore scroll position
  function restoreScrollPosition(scrollData) {
    if (
      scrollData &&
      typeof scrollData.scrollX === 'number' &&
      typeof scrollData.scrollY === 'number'
    ) {
      window.scrollTo(scrollData.scrollX, scrollData.scrollY);
    }
  }

  // Initialize monitoring
  function initializeMonitoring() {
    // Send initial page data
    const initialData = getCurrentPageData();
    lastTitle = initialData.title;
    lastScrollX = initialData.scrollX;
    lastScrollY = initialData.scrollY;

    sendToExtension({
      type: 'page-load',
      ...initialData,
    });

    // Monitor title changes using MutationObserver
    const titleObserver = new MutationObserver(() => {
      handleTitleChange();
    });

    titleObserver.observe(document.querySelector('title') || document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Monitor scroll events
    let scrollTimer;
    window.addEventListener(
      'scroll',
      () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(handleScroll, 100); // Debounce scroll events
      },
      { passive: true },
    );

    // Monitor hash changes (for SPAs)
    window.addEventListener('hashchange', () => {
      sendToExtension({
        type: 'url-change',
        ...getCurrentPageData(),
      });
    });

    // Monitor popstate events (for SPAs)
    window.addEventListener('popstate', () => {
      sendToExtension({
        type: 'url-change',
        ...getCurrentPageData(),
      });
    });

    // Listen for messages from the extension to restore state
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        message.action === 'restore-iframe-state' &&
        message.noteId === getNoteId()
      ) {
        if (message.scrollData) {
          restoreScrollPosition(message.scrollData);
        }
        sendResponse({ success: true });
      }
    });

    console.debug(
      'Sticky Bear content script initialized for note:',
      getNoteId(),
    );
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMonitoring);
  } else {
    initializeMonitoring();
  }

  // Handle page unload to send final state
  window.addEventListener('beforeunload', () => {
    sendToExtension({
      type: 'page-unload',
      ...getCurrentPageData(),
    });
  });
})();
