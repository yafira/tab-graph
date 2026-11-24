// the toolbar button opens the graph, or jumps to it if it's already open
const page = browser.runtime.getURL('graph.html')

browser.action.onClicked.addListener(async () => {
  const tabs = await browser.tabs.query({})
  const open = tabs.find((t) => t.url && t.url.startsWith(page))
  if (open) {
    await browser.tabs.update(open.id, { active: true })
    await browser.windows.update(open.windowId, { focused: true })
  } else {
    await browser.tabs.create({ url: page })
  }
})
