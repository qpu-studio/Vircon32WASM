// Stress test for comparing emulator cores: exercises the CPU (int/float/math),
// GPU (all draw modes and blending), SPU (loops, speeds, positions),
// RNG, gamepad reads and the memory card. Results are written to the card.
#include "math.h"
#include "video.h"
#include "audio.h"
#include "input.h"
#include "memcard.h"
#include "misc.h"
#include "time.h"

int[ 4096 ] results;
int n = 0;

void put_int( int v ) { results[ n % 4096 ] ^= v + n; n++; }
void put_float( float f ) { int* p = (int*)&f; put_int( *p ); }

void math_tests( int frame )
{
    float x = ( (rand() % 20001) - 10000 ) / 997.0;
    float y = ( (rand() % 20001) - 10000 ) / 331.0;
    put_float( sin( x ) );
    put_float( cos( y ) );
    put_float( atan2( x, y ) );
    if( x > -1 && x < 1 ) put_float( acos( x ) );
    put_float( acos( x / 11.0 ) );
    if( y > 0 ) put_float( log( y ) );
    put_float( pow( fabs( x ), y / 7.0 ) );
    put_float( pow( -2.0, 3.0 ) );
    put_float( sqrt( fabs( y ) ) );
    put_float( exp( x / 3.0 ) );
    put_float( fmod( x, y + 0.5 ) );
    put_float( floor( x ) + ceil( y ) + round( x * y ) );
    put_float( fmin( x, y ) - fmax( x, y ) );
    put_float( tan( x ) + asin( x / 11.0 ) );
    int a = rand() - 1073741824, b = rand() % 37 - 18;
    put_int( a * b );
    put_int( a << (frame % 33) );
    put_int( a >> (frame % 33) );
    if( b != 0 ) { put_int( a / b ); put_int( a % b ); }
    put_int( a & b ); put_int( a | b ); put_int( a ^ b ); put_int( ~a ); put_int( !a );
    put_int( min( a, b ) + max( a, b ) + abs( a ) );
    put_int( (int)( x * 1000.0 ) );
    put_float( (float)a );
    put_int( a > b ); put_int( x <= y );
}

void draw_tests( int frame )
{
    clear_screen( make_color_rgba( frame % 256, 40, 80, 255 ) );
    select_texture( -1 );
    for( int i = 0; i < 40; i++ )
    {
        select_region( i % 8 );
        define_region( i * 3, i * 2, i * 3 + 20 + i, i * 2 + 15, i * 3 + 5, i * 2 + 5 );
        set_multiply_color( make_color_rgba( 255 - i * 5, 100 + i, i * 6, 128 + i * 3 ) );
        set_blending_mode( blending_alpha + (i % 3) );
        set_drawing_point( (i * 37 + frame * 3) % 700 - 30, (i * 23 + frame) % 400 - 20 );
        float s = sin( frame * 0.05 + i ) * 3.0;
        set_drawing_scale( s, -s * 0.7 + 0.01 );
        set_drawing_angle( frame * 0.031 * i );
        if( i % 4 == 0 ) draw_region();
        else if( i % 4 == 1 ) draw_region_zoomed();
        else if( i % 4 == 2 ) draw_region_rotated();
        else draw_region_rotozoomed();
    }
    set_blending_mode( blending_alpha );
}

void sound_tests( int frame )
{
    if( frame % 37 == 0 )
    {
        int c = frame % 16;
        select_sound( -1 );
        set_sound_loop( frame % 2 );
        set_sound_loop_start( 100 + frame );
        set_sound_loop_end( 3000 + frame * 7 );
        select_channel( c );
        set_channel_volume( 0.3 + (frame % 5) * 0.4 );
        set_channel_speed( 0.25 + (frame % 9) * 0.37 );
        set_channel_loop( frame % 3 == 0 );
        play_sound_in_channel( -1, c );
        set_channel_position( frame * 13 );
    }
    if( frame % 101 == 0 ) pause_all_channels();
    if( frame % 101 == 9 ) resume_all_channels();
    if( frame % 503 == 0 ) stop_all_channels();
    put_int( get_channel_position( frame % 16 ) );
    put_int( get_channel_state( frame % 16 ) );
    set_global_volume( 0.5 + (frame % 7) * 0.2 );
}

void main( void )
{
    srand( 1234 );
    int frame = 0;
    while( true )
    {
        math_tests( frame );
        draw_tests( frame );
        sound_tests( frame );
        select_gamepad( 0 );
        put_int( gamepad_button_a() + gamepad_left() * 3 + gamepad_button_start() * 7 );
        if( frame % 120 == 119 && card_is_connected() )
          card_write_data( results, 0, 4096 );
        frame++;
        end_frame();
    }
}
