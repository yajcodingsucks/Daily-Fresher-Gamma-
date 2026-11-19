; Extra installer steps for electron-builder's NSIS installer (package.json "nsis.include").
; The app needs Windows 10 or newer (Electron does not run on Windows 7 / 8 / 8.1).
!include WinVer.nsh

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Daily Fresher Invoices needs Windows 10 or Windows 11.$\r$\nThis computer has an older Windows, so the app cannot be installed." /SD IDOK
    Quit
  ${EndIf}
!macroend
