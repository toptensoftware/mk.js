#include <stdio.h>

__declspec(dllexport) int sub(int a, int b)
{
    return a - b;
}