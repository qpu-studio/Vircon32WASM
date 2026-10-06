// CPU-bound benchmark: never waits, so it uses 100% of the CPU every frame
#include "math.h"
#include "video.h"
#include "misc.h"
int[ 256 ] table;
void main( void )
{
    int i = 0; float acc = 0;
    while( true )
    {
        table[ i & 255 ] = table[ (i * 7) & 255 ] + i * 3;
        acc += sin( i * 0.001 ) * 0.5;
        if( table[ i & 255 ] > 1000000 ) table[ i & 255 ] = (int)acc;
        i++;
    }
}
