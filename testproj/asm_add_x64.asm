; Assemble with: ml64 /c asm_add.asm
; Link together with a C driver program using MSVC

option casemap:none        ; case sensitivity

PUBLIC asm_add
.code

asm_add PROC
    mov     rax, rcx       ; copy first argument (in rcx)
    add     rax, rdx       ; add second argument (in rdx)
    ret
asm_add ENDP

END