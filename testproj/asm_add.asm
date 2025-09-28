; Assemble with: ml64 /c asm_add.asm
; Link together with a C driver program using MSVC

option casemap:none        ; case sensitivity

IFDEF _WIN64

PUBLIC asm_add
.code

asm_add PROC
    mov     rax, rcx       ; copy first argument (in rcx)
    add     rax, rdx       ; add second argument (in rdx)
    ret
asm_add ENDP

ELSE

PUBLIC asm_add
.model flat, c
.code

asm_add PROC
    mov     eax, DWORD PTR [esp+4]   ; get first argument
    add     eax, DWORD PTR [esp+8]   ; add second argument
    ret
asm_add ENDP

ENDIF


END
