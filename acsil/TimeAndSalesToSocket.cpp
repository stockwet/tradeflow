// Time & Sales TCP Socket Exporter
// Sends tick data over TCP socket to external applications

#include "sierrachart.h"
#include <winsock2.h>
#include <ws2tcpip.h>

#pragma comment(lib, "ws2_32.lib")

SCDLLName("Time & Sales TCP Socket Exporter")

// Structure to hold socket state
struct SocketState {
    SOCKET ClientSocket;
    bool Connected;
    int SequenceNumber;
    int64_t LastProcessedSequence;
};

SCSFExport scsf_TimeAndSalesToSocket(SCStudyInterfaceRef sc)
{
    SCInputRef Input_Enabled = sc.Input[0];
    SCInputRef Input_Port = sc.Input[1];
    
    if (sc.SetDefaults)
    {
        sc.GraphName = "Time & Sales TCP Socket Exporter";
        sc.StudyDescription = "Sends real-time tick data over TCP socket";
        sc.GraphRegion = 0;
        sc.AutoLoop = 0;
        sc.UpdateAlways = 1;
        
        Input_Enabled.Name = "Enable Export";
        Input_Enabled.SetYesNo(0);
        
        Input_Port.Name = "TCP Port";
        Input_Port.SetInt(9999);
        
        return;
    }
    
    if (Input_Enabled.GetYesNo() == 0)
        return;
    
    // Get persistent socket state
    SocketState* pState = reinterpret_cast<SocketState*>(sc.GetPersistentPointer(1));
    
    // Initialize socket on first run
    if (pState == NULL)
    {
        pState = new SocketState();
        pState->ClientSocket = INVALID_SOCKET;
        pState->Connected = false;
        pState->SequenceNumber = 0;
        pState->LastProcessedSequence = 0;
        sc.SetPersistentPointer(1, pState);
        
        // Initialize Winsock
        WSADATA wsaData;
        int result = WSAStartup(MAKEWORD(2, 2), &wsaData);
        if (result != 0)
        {
            sc.AddMessageToLog("Failed to initialize Winsock", 1);
            return;
        }
        
        sc.AddMessageToLog("Socket Exporter: Initialized", 0);
    }
    
    // Try to connect if not connected
    if (!pState->Connected)
    {
        // Create socket
        pState->ClientSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (pState->ClientSocket == INVALID_SOCKET)
        {
            return;
        }
        
        // Set non-blocking mode
        u_long mode = 1;
        ioctlsocket(pState->ClientSocket, FIONBIO, &mode);
        
        // Connect to localhost
        sockaddr_in serverAddr;
        serverAddr.sin_family = AF_INET;
        serverAddr.sin_port = htons(Input_Port.GetInt());
        inet_pton(AF_INET, "127.0.0.1", &serverAddr.sin_addr);
        
        int connectResult = connect(pState->ClientSocket, (SOCKADDR*)&serverAddr, sizeof(serverAddr));
        
        if (connectResult == SOCKET_ERROR)
        {
            int error = WSAGetLastError();
            if (error == WSAEWOULDBLOCK)
            {
                // Connection in progress - check later
                return;
            }
            else if (error == WSAEISCONN)
            {
                // Already connected
                pState->Connected = true;
                sc.AddMessageToLog("Socket Exporter: Connected", 0);
            }
            else
            {
                // Connection failed
                closesocket(pState->ClientSocket);
                pState->ClientSocket = INVALID_SOCKET;
                return;
            }
        }
        else
        {
            pState->Connected = true;
            sc.AddMessageToLog("Socket Exporter: Connected", 0);
        }
    }
    
    if (!pState->Connected)
        return;
    
    // Get symbol
    SCString SymbolName = sc.GetRealTimeSymbol();
    
    // Get Time and Sales
    c_SCTimeAndSalesArray TimeSales;
    sc.GetTimeAndSales(TimeSales);
    
    if (TimeSales.Size() == 0)
        return;
    
    // Set initial sequence if needed
    if (pState->LastProcessedSequence == 0)
    {
        pState->LastProcessedSequence = TimeSales[TimeSales.Size() - 1].Sequence;
        return;
    }
    
    // Process new ticks
    int TicksSent = 0;
    
    for (int i = 0; i < TimeSales.Size(); i++)
    {
        s_TimeAndSales Record = TimeSales[i];
        
        // Skip already processed
        if (Record.Sequence <= pState->LastProcessedSequence)
            continue;
        
        pState->LastProcessedSequence = Record.Sequence;
        
        // Only process actual trades
        if (Record.Type != SC_TS_BID && Record.Type != SC_TS_ASK)
            continue;
        
        // Convert DateTime to milliseconds
        SCDateTime DateTime = Record.DateTime;
        const double UnixEpochInExcelDays = 25569.0;
        const double MillisecondsPerDay = 86400000.0;
        double ExcelDateTime = DateTime.GetAsDouble();
        int64_t TimestampMs = static_cast<int64_t>((ExcelDateTime - UnixEpochInExcelDays) * MillisecondsPerDay);
        int Milliseconds = DateTime.GetMillisecond();
        TimestampMs = (TimestampMs / 1000) * 1000 + Milliseconds;
        
        // Determine side
        const char* Side = (Record.Type == SC_TS_ASK) ? "ASK" : "BID";
        
        // Increment sequence
        pState->SequenceNumber++;
        
        // Build JSON message
        char buffer[512];
        int len = sprintf_s(buffer, sizeof(buffer),
                           "{\"seq\":%d,\"ts\":%lld,\"p\":%.2f,\"v\":%u,\"s\":\"%s\",\"sym\":\"%s\"}\n",
                           pState->SequenceNumber,
                           TimestampMs,
                           Record.Price,
                           Record.Volume,
                           Side,
                           SymbolName.GetChars());
        
        // Send to socket
        int sendResult = send(pState->ClientSocket, buffer, len, 0);
        
        if (sendResult == SOCKET_ERROR)
        {
            int error = WSAGetLastError();
            if (error == WSAEWOULDBLOCK)
            {
                // Socket buffer full - skip this tick
                continue;
            }
            else
            {
                // Connection lost
                sc.AddMessageToLog("Socket Exporter: Connection lost", 1);
                closesocket(pState->ClientSocket);
                pState->ClientSocket = INVALID_SOCKET;
                pState->Connected = false;
                return;
            }
        }
        
        TicksSent++;
    }
    
    // Log periodically
    static int s_TotalSent = 0;
    s_TotalSent += TicksSent;
    
    if (s_TotalSent >= 100)
    {
        SCString Msg;
        Msg.Format("Socket Exporter: Sent %d ticks (total: %d)", s_TotalSent, pState->SequenceNumber);
        sc.AddMessageToLog(Msg, 0);
        s_TotalSent = 0;
    }
}