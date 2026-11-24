# tab graph

a firefox / zen extension that shows your open tabs as a graph and lets you manage them from there.

- the window sits in the middle
- a site with more than one tab gets a hub, with its tabs around it
- a pink line joins a tab to the tab it was opened from
- the tab showing in its window has a ring, sleeping tabs are hollow

## try it in zen

1. go to `about:debugging#/runtime/this-firefox`
2. click "load temporary add-on"
3. pick `manifest.json` from this folder
4. click the tab graph button in the toolbar (it may be under the extensions menu)

a temporary add-on goes away when zen restarts. to keep it, it has to be signed at addons.mozilla.org (free, can be unlisted).

## controls

- click a tab: go to it
- right-click a tab: reload, duplicate, pin, mute, move to a new window, copy link, put to sleep, close
- right-click a site hub: do those to all of its tabs at once
- right-click empty space: new tab, reopen closed tab
- delete or backspace: close the tab under the pointer
- shift-click: close a tab
- graph / list switch in the header. the list has the same tabs as rows, with a close button on each
- `/` to search, escape to clear. search works in both views
- drag to move things, scroll to zoom

## files

- `manifest.json` permissions are `tabs` (titles and urls) and `sessions` (reopen closed tab). nothing leaves the browser
- `background.js` the toolbar button
- `graph.html`, `graph.css`, `graph.js` the graph page
- `fonts/` departure mono by helena zhang, under the sil open font license (`fonts/OFL.txt`)
