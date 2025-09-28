    .section .note.GNU-stack,"",@progbits
    .text
    .globl asm_add
    .type asm_add, @function

#include "other.h"

asm_add:
    movq     %rdi, %rax         # copy first argument into rax
    addq     %rsi, %rax         # add second argument
    ret

