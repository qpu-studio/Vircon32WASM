// =============================================================================
//  C interface between the official Vircon32 ConsoleLogic (C++) and
//  JavaScript, for the Emscripten / WebAssembly build.
//
//  - Video callbacks are forwarded to Module.video (see web/src/WasmCore.ts)
//  - Files (BIOS, cartridges, memory cards) are passed through the
//    Emscripten in-memory filesystem, so the C++ loaders are used unchanged
//  - Errors thrown by the console are caught here and returned as strings
// =============================================================================

#include "ConsoleLogic/V32Console.hpp"
#include <emscripten.h>
#include <cstring>
#include <string>
#include <stdexcept>

using namespace V32;
using namespace std;

// -----------------------------------------------------------------------------
//  Video callbacks implemented in JavaScript
// -----------------------------------------------------------------------------

EM_JS( void, js_clear_screen, (uint32_t color), { Module.video.clearScreen( color | 0 ); } );
EM_JS( void, js_draw_quad, (float* quad), { Module.video.drawQuad( HEAPF32.subarray( quad >> 2, (quad >> 2) + 16 ) ); } );
EM_JS( void, js_set_multiply_color, (uint32_t color), { Module.video.setMultiplyColor( color | 0 ); } );
EM_JS( void, js_set_blending_mode, (int mode), { Module.video.setBlendingMode( mode ); } );
EM_JS( void, js_select_texture, (int id), { Module.video.selectTexture( id ); } );
EM_JS( void, js_load_texture, (int id, uint8_t* pixels), { Module.video.loadTexture( id, HEAPU8.subarray( pixels, pixels + 1024 * 1024 * 4 ) ); } );
EM_JS( void, js_unload_cartridge_textures, (), { Module.video.unloadCartridgeTextures(); } );
EM_JS( void, js_unload_bios_texture, (), { Module.video.unloadBiosTexture(); } );
EM_JS( void, js_log_line, (const char* text), { if( Module.logLine ) Module.logLine( UTF8ToString( text ) ); } );

static uint32_t ColorToWord( GPUColor Color )
{
    uint32_t Word;
    memcpy( &Word, &Color, 4 );
    return Word;
}

static void CB_ClearScreen( GPUColor Color )        { js_clear_screen( ColorToWord( Color ) ); }
static void CB_DrawQuad( GPUQuad& Quad )            { js_draw_quad( &Quad.Vertices[ 0 ].x ); }
static void CB_SetMultiplyColor( GPUColor Color )   { js_set_multiply_color( ColorToWord( Color ) ); }
static void CB_SetBlendingMode( int Mode )          { js_set_blending_mode( Mode ); }
static void CB_SelectTexture( int ID )              { js_select_texture( ID ); }
static void CB_LoadTexture( int ID, void* Pixels )  { js_load_texture( ID, (uint8_t*)Pixels ); }
static void CB_UnloadCartridgeTextures()            { js_unload_cartridge_textures(); }
static void CB_UnloadBiosTexture()                  { js_unload_bios_texture(); }
static void CB_LogLine( const string& Text )        { js_log_line( Text.c_str() ); }
static void CB_ThrowException( const string& Text ) { throw runtime_error( Text ); }

// -----------------------------------------------------------------------------
//  The console (too large for the stack, so it lives in the heap)
// -----------------------------------------------------------------------------

static V32Console* Console = nullptr;
static string LastError;
static string ReturnedString;

// runs an action and returns nullptr on success, or the error message
template< typename F >
static const char* Try( F Action )
{
    try
    {
        Action();
        return nullptr;
    }
    catch( const exception& e )
    {
        LastError = e.what();
        return LastError.c_str();
    }
}

extern "C"
{
    EMSCRIPTEN_KEEPALIVE void v32_initialize()
    {
        if( Console ) return;
        Callbacks::ClearScreen = CB_ClearScreen;
        Callbacks::DrawQuad = CB_DrawQuad;
        Callbacks::SetMultiplyColor = CB_SetMultiplyColor;
        Callbacks::SetBlendingMode = CB_SetBlendingMode;
        Callbacks::SelectTexture = CB_SelectTexture;
        Callbacks::LoadTexture = CB_LoadTexture;
        Callbacks::UnloadCartridgeTextures = CB_UnloadCartridgeTextures;
        Callbacks::UnloadBiosTexture = CB_UnloadBiosTexture;
        Callbacks::LogLine = CB_LogLine;
        Callbacks::ThrowException = CB_ThrowException;
        Console = new V32Console();
    }

    // ---------- power & frames ----------

    EMSCRIPTEN_KEEPALIVE void v32_set_power( int On )  { Console->SetPower( On != 0 ); }
    EMSCRIPTEN_KEEPALIVE int  v32_is_power_on()        { return Console->IsPowerOn(); }
    EMSCRIPTEN_KEEPALIVE int  v32_is_cpu_halted()      { return Console->IsCPUHalted(); }
    EMSCRIPTEN_KEEPALIVE void v32_reset()              { Console->Reset(); }
    EMSCRIPTEN_KEEPALIVE float v32_get_cpu_load()      { return Console->GetCPULoad(); }
    EMSCRIPTEN_KEEPALIVE float v32_get_gpu_load()      { return Console->GetGPULoad(); }

    // (when the program writes to the memory card, the console itself
    // saves it to its linked file at the end of the frame)
    EMSCRIPTEN_KEEPALIVE void v32_run_next_frame()
    {
        Console->RunNextFrame();
    }

    // ---------- BIOS & cartridge ----------

    EMSCRIPTEN_KEEPALIVE const char* v32_load_bios( const char* Path )
    {
        return Try( [&]{ Console->LoadBios( Path ); } );
    }

    EMSCRIPTEN_KEEPALIVE const char* v32_load_cartridge( const char* Path )
    {
        return Try( [&]{ Console->LoadCartridge( Path ); } );
    }

    EMSCRIPTEN_KEEPALIVE void v32_unload_cartridge()   { Console->UnloadCartridge(); }
    EMSCRIPTEN_KEEPALIVE int  v32_has_cartridge()      { return Console->HasCartridge(); }

    EMSCRIPTEN_KEEPALIVE const char* v32_get_cartridge_title()
    {
        ReturnedString = Console->GetCartridgeTitle();
        return ReturnedString.c_str();
    }

    // ---------- memory card ----------

    EMSCRIPTEN_KEEPALIVE const char* v32_create_memory_card( const char* Path )
    {
        return Try( [&]{ Console->CreateMemoryCard( Path ); } );
    }

    EMSCRIPTEN_KEEPALIVE const char* v32_load_memory_card( const char* Path )
    {
        return Try( [&]{ Console->LoadMemoryCard( Path ); } );
    }

    EMSCRIPTEN_KEEPALIVE void v32_unload_memory_card()  { Try( [&]{ Console->UnloadMemoryCard(); } ); }
    EMSCRIPTEN_KEEPALIVE int  v32_has_memory_card()     { return Console->HasMemoryCard(); }

    // makes sure the card file in the virtual filesystem is up to date
    EMSCRIPTEN_KEEPALIVE void v32_flush_memory_card()
    {
        if( Console->MemoryCardController.LinkedFile.is_open() )
          Console->MemoryCardController.LinkedFile.flush();
    }

    // ---------- gamepads ----------

    EMSCRIPTEN_KEEPALIVE void v32_set_gamepad_connection( int Port, int Connected )
    {
        Console->SetGamepadConnection( Port, Connected != 0 );
    }

    EMSCRIPTEN_KEEPALIVE void v32_set_gamepad_control( int Port, int Control, int Pressed )
    {
        Console->SetGamepadControl( Port, (GamepadControls)Control, Pressed != 0 );
    }

    // ---------- date & time ----------

    EMSCRIPTEN_KEEPALIVE void v32_set_current_date( int Year, int Days )  { Console->SetCurrentDate( Year, Days ); }
    EMSCRIPTEN_KEEPALIVE void v32_set_current_time( int H, int M, int S ) { Console->SetCurrentTime( H, M, S ); }

    // ---------- sound ----------

    // pointer to the 735 stereo int16 samples generated in the last frame
    EMSCRIPTEN_KEEPALIVE const SPUSample* v32_get_sound_samples()
    {
        return Console->SPU.OutputBuffer.Samples;
    }
}
