; Assemble with: ml /c /coff asm_add.asm
; Link with a 32-bit C program

option casemap:none

PUBLIC asm_add
.code

asm_add PROC
    mov     eax, DWORD PTR [esp+4]   ; get first argument
    add     eax, DWORD PTR [esp+8]   ; add second argument
    ret
asm_add ENDP

END
