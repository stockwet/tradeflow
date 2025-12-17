// Time & Sales to File Exporter (Simple Version)
// Exports tick data to a file that Node.js can read

#include "sierrachart.h"

SCDLLName("Time & Sales File Exporter")

SCSFExport scsf_TimeAndSalesToFile(SCStudyInterfaceRef sc)
{
    SCInputRef Input_Enabled = sc.Input[0];
    SCInputRef Input_OutputFile = sc.Input[1];
    SCInputRef Input_MaxFileSize = sc.Input[2];
    
    int& r_LastProcessedIndex = sc.GetPersistentInt(1);
    int& r_SequenceNumber = sc.GetPersistentInt(2);
    
    if (sc.SetDefaults)
    {
        sc.GraphName = "Time & Sales to File Exporter";
        sc.StudyDescription = "Exports real-time tick data to a file in JSON Lines format";
        sc.GraphRegion = 0;
        sc.AutoLoop = 0;
        
        Input_Enabled.Name = "Enable Export";
        Input_Enabled.SetYesNo(0);
        
        Input_OutputFile.Name = "Output File Path";
        Input_OutputFile.SetPathAndFileName("C:\\TradeFlowData\\ticks.jsonl");
        
        Input_MaxFileSize.Name = "Max File Size (KB, 0=unlimited)";
        Input_MaxFileSize.SetInt(1000);  // 1MB default
        
        return;
    }
    
    if (Input_Enabled.GetYesNo() == 0)
        return;
    
    // Get symbol
    SCString SymbolName = sc.GetRealTimeSymbol();
    
    // Get Time and Sales using correct API
    c_SCTimeAndSalesArray TimeSales;
    sc.GetTimeAndSales(TimeSales);
    
    int NumRecords = TimeSales.Size();
    
    if (NumRecords == 0)
        return;
    
    // Check file size and rotate if needed
    SCString OutputPath = Input_OutputFile.GetPathAndFileName();
    int MaxSizeKB = Input_MaxFileSize.GetInt();
    
    if (MaxSizeKB > 0)
    {
        FILE* CheckFile = NULL;
        fopen_s(&CheckFile, OutputPath, "r");
        if (CheckFile != NULL)
        {
            fseek(CheckFile, 0, SEEK_END);
            long FileSize = ftell(CheckFile);
            fclose(CheckFile);
            
            // If file exceeds max size, delete it
            if (FileSize > (MaxSizeKB * 1024))
            {
                DeleteFileA(OutputPath);
                sc.AddMessageToLog("Tick file rotated (size limit reached)", 0);
            }
        }
    }
    
    // Open file for append
    FILE* OutputFile = NULL;
    errno_t err = fopen_s(&OutputFile, OutputPath, "a");
    
    if (OutputFile == NULL)
    {
        SCString ErrorMsg;
        ErrorMsg.Format("Failed to open file: %s (error %d)", OutputPath.GetChars(), err);
        sc.AddMessageToLog(ErrorMsg, 1);
        return;
    }
    
    // Process new records
    int NewTicksWritten = 0;
    
    for (int RecordIndex = r_LastProcessedIndex; RecordIndex < NumRecords; RecordIndex++)
    {
        s_TimeAndSales Record = TimeSales[RecordIndex];
        
        // Only process actual trades (not bid/ask updates)
        if (Record.Type != SC_TS_BID && Record.Type != SC_TS_ASK)
            continue;
        
        // Convert DateTime to Unix timestamp in milliseconds
        SCDateTime DateTime = Record.DateTime;
        
        // SCDateTime stores date-time as double (Excel date format)
        // Convert to Unix timestamp manually
        // Excel epoch: Jan 1, 1900. Unix epoch: Jan 1, 1970
        // Difference: 25569 days
        const double UnixEpochInExcelDays = 25569.0;
        const double MillisecondsPerDay = 86400000.0;
        
        double ExcelDateTime = DateTime.GetAsDouble();
        int64_t TimestampMs = static_cast<int64_t>((ExcelDateTime - UnixEpochInExcelDays) * MillisecondsPerDay);
        
        // Add milliseconds component
        int Milliseconds = DateTime.GetMillisecond();
        TimestampMs = (TimestampMs / 1000) * 1000 + Milliseconds;  // Replace millisecond component
        
        // Determine side
        const char* Side = "UNKNOWN";
        if (Record.Type == SC_TS_ASK)
            Side = "ASK";
        else if (Record.Type == SC_TS_BID)
            Side = "BID";
        
        // Increment sequence
        r_SequenceNumber++;
        
        // Write JSON line
        // Format: {"seq":N,"ts":TIMESTAMP,"p":PRICE,"v":VOLUME,"s":"SIDE","sym":"SYMBOL"}
        fprintf(OutputFile, "{\"seq\":%d,\"ts\":%lld,\"p\":%.2f,\"v\":%u,\"s\":\"%s\",\"sym\":\"%s\"}\n",
                r_SequenceNumber,
                TimestampMs,
                Record.Price,
                Record.Volume,
                Side,
                SymbolName.GetChars());
        
        NewTicksWritten++;
    }
    
    fclose(OutputFile);
    
    // Update last processed index
    r_LastProcessedIndex = NumRecords;
    
    // Log periodically
    static int s_LogCounter = 0;
    s_LogCounter += NewTicksWritten;
    if (s_LogCounter >= 100)  // Log every 100 ticks
    {
        SCString Msg;
        Msg.Format("Exported %d ticks (total: %d)", s_LogCounter, r_SequenceNumber);
        sc.AddMessageToLog(Msg, 0);
        s_LogCounter = 0;
    }
}