const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hyadeOSElectron', Object.freeze({
    shutdown: () => ipcRenderer.invoke('hyadeos:shutdown'),
    reboot: () => ipcRenderer.invoke('hyadeos:reboot'),
    clearBrowserData: () => ipcRenderer.invoke('hyadeos:clear-browser-data'),
    browserExtensions: Object.freeze({
        list: () => ipcRenderer.invoke('hyadeos:extensions-list'),
        install: input => ipcRenderer.invoke('hyadeos:extensions-install', String(input)),
        loadUnpacked: () => ipcRenderer.invoke('hyadeos:extensions-load-unpacked'),
        setEnabled: (id, enabled) => ipcRenderer.invoke('hyadeos:extensions-set-enabled', String(id), !!enabled),
        remove: id => ipcRenderer.invoke('hyadeos:extensions-remove', String(id))
    }),
    onBrowserOpenTab: callback => ipcRenderer.on('browser:open-tab', (_event, url) => callback(String(url))),
    onBrowserShortcut: callback => ipcRenderer.on('browser:shortcut', (_event, name) => callback(String(name))),
    // Alt+Tab window switcher: next, prev, commit, cancel (see launcher.js).
    setPrivacy: on => ipcRenderer.invoke('hyadeos:set-privacy', !!on),
    onShellSwitcher: callback => ipcRenderer.on('shell:switcher', (_event, action) => callback(String(action))),
    // Only answered for the local kernel-recovery.html screen (checked in launcher.js).
    kernelRecovery: Object.freeze({
        getState: () => ipcRenderer.invoke('hyadeos:recovery-state'),
        retry: () => ipcRenderer.invoke('hyadeos:recovery-retry'),
        rollback: () => ipcRenderer.invoke('hyadeos:recovery-rollback'),
        repairDependencies: () => ipcRenderer.invoke('hyadeos:recovery-repair'),
        openLogFolder: () => ipcRenderer.invoke('hyadeos:recovery-open-folder'),
        sendReport: () => ipcRenderer.invoke('hyadeos:recovery-send-report'),
        quit: () => ipcRenderer.invoke('hyadeos:recovery-quit')
    })
}));
