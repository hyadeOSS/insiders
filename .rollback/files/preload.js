const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hyadeOSSElectron', Object.freeze({
    shutdown: () => ipcRenderer.invoke('hyadeoss:shutdown'),
    reboot: () => ipcRenderer.invoke('hyadeoss:reboot'),
    clearBrowserData: () => ipcRenderer.invoke('hyadeoss:clear-browser-data'),
    browserExtensions: Object.freeze({
        list: () => ipcRenderer.invoke('hyadeoss:extensions-list'),
        install: input => ipcRenderer.invoke('hyadeoss:extensions-install', String(input)),
        loadUnpacked: () => ipcRenderer.invoke('hyadeoss:extensions-load-unpacked'),
        setEnabled: (id, enabled) => ipcRenderer.invoke('hyadeoss:extensions-set-enabled', String(id), !!enabled),
        remove: id => ipcRenderer.invoke('hyadeoss:extensions-remove', String(id))
    }),
    onBrowserOpenTab: callback => ipcRenderer.on('browser:open-tab', (_event, url) => callback(String(url))),
    onBrowserShortcut: callback => ipcRenderer.on('browser:shortcut', (_event, name) => callback(String(name))),
    // Alt+Tab window switcher: next, prev, commit, cancel (see launcher.js).
    setPrivacy: on => ipcRenderer.invoke('hyadeoss:set-privacy', !!on),
    onShellSwitcher: callback => ipcRenderer.on('shell:switcher', (_event, action) => callback(String(action))),
    // Only answered for the local kernel-recovery.html screen (checked in launcher.js).
    kernelRecovery: Object.freeze({
        getState: () => ipcRenderer.invoke('hyadeoss:recovery-state'),
        retry: () => ipcRenderer.invoke('hyadeoss:recovery-retry'),
        rollback: () => ipcRenderer.invoke('hyadeoss:recovery-rollback'),
        repairDependencies: () => ipcRenderer.invoke('hyadeoss:recovery-repair'),
        openLogFolder: () => ipcRenderer.invoke('hyadeoss:recovery-open-folder'),
        sendReport: () => ipcRenderer.invoke('hyadeoss:recovery-send-report'),
        quit: () => ipcRenderer.invoke('hyadeoss:recovery-quit')
    })
}));
