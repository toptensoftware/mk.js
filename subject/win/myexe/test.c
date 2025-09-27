#include "precomp.h"
#include "test.h"
#include "other.h"

#include "mylib/api.h"

#ifdef _DEBUG
const char* config = "debug";
#else
const char* config = "release";
#endif

int main()
{
    int result = add(20, 3);
    printf("Hello World!!! %i\n", result);
    printf("config: %s platform: %s\n", config, sizeof(void*) == 4 ? "x86" : "x64");  
    return 0;
}