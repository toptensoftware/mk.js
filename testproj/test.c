#include "precomp.h"
#include "test.h"
#include "other.h"

#include "static-lib/static-lib.h"
#include "shared-lib/shared-lib.h"

#ifdef _DEBUG
const char* config = "debug";
#else
const char* config = "release";
#endif

int asm_add(int a, int b);

int main()
{
    printf("Hello World!!!\n");
    printf("config: %s platform: %s\n", config, sizeof(void*) == 4 ? "x86" : "x64");  

    printf("static-lib: %i\n", add(20, 3));
    printf("shared-lib: %i\n", sub(20, 3));
    printf("asm_add: %i\n", asm_add(20, 3));
    return 0;
}