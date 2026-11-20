// Clicking the toolbar icon opens the paste/drop viewer page. Nothing else runs here.
chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});
