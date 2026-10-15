!macro customInstall
  WriteRegStr HKCU "Software\Classes\floatcode" "" "URL:FloatCode invitation"
  WriteRegStr HKCU "Software\Classes\floatcode" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\floatcode\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\floatcode\shell\open\command" "" '$"$INSTDIR\${APP_EXECUTABLE_FILENAME}$" $"%1$"'
!macroend

!macro customUnInstall
  ReadRegStr $0 HKCU "Software\Classes\floatcode\shell\open\command" ""
  StrCmp $0 '$"$INSTDIR\${APP_EXECUTABLE_FILENAME}$" $"%1$"' 0 +2
    DeleteRegKey HKCU "Software\Classes\floatcode"
!macroend
