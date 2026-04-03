LANGUAGE_HINTS = {
    "powerbuilder": {
        "description": "PowerBuilder / PowerScript with DataWindow technology",
        "common_patterns": [
            "DataWindow operations: Retrieve(), Update(), InsertRow(), DeleteRow(), "
            "GetItemString(), GetItemNumber(), SetItem(), RowCount(), GetRow()",
            "DataStore (non-visual DataWindow equivalent for batch processing)",
            "Row states: New!, NewModified!, NotModified!, DataModified!",
            "Buffers: Primary!, Delete!, Filter! — rows move between buffers",
            "Global and instance variables (g_, i_ prefixes)",
            "Events: Clicked!, Open, Close, Constructor, Destructor, ue_ custom events",
            "Embedded SQL: SELECT INTO, INSERT, UPDATE, DELETE, DECLARE CURSOR, FETCH",
            "SQLCA transaction object: SQLCode (0=ok, 100=not found, -1=error), "
            "SQLErrText, SQLNRows",
            "COMMIT USING SQLCA / ROLLBACK USING SQLCA for explicit transaction control",
            "PowerBuilder Foundation Classes (PFC) service architecture",
            "MessageBox(title, message) for user-facing alerts",
            "IsNull() function for null checking, Len() for string length",
            "PBNI (PowerBuilder Native Interface) for external DLL calls",
            "Message object for inter-window communication, OpenWithParm",
            "Application, Window, Menu, UserObject inheritance hierarchy",
            "1-based row/column indexing in DataWindow operations",
        ],
        "migration_notes": (
            "CRITICAL MIGRATION RULES:\n"
            "1. DataWindow → IDataWindowAdapter<T> (NOT raw EF Core DbSet). "
            "The adapter must maintain in-memory row buffers with row-level state "
            "tracking. GetItemString → adapter.GetItem<string>(row, col). "
            "Update() only persists changed rows.\n"
            "2. SQLCA → try/catch with IDbConnection. "
            "SQLCode 0 = success, 100 = not found (check result.Any()), -1 = DbException. "
            "Preserve exact return codes (-1 for error, etc.).\n"
            "3. MessageBox() → INotificationService.ShowInfoAsync() or .ShowErrorAsync(). "
            "Preserve exact title + message strings. Do NOT use Console.WriteLine.\n"
            "4. COMMIT/ROLLBACK → explicit transaction.CommitAsync()/RollbackAsync() "
            "at the SAME points as PB. Never auto-commit.\n"
            "5. Events → async Task methods preserving sequential control flow.\n"
            "6. PB's + string concatenation → C# string interpolation.\n"
            "7. PB's IsNull(val) → val is null; Len(s) = 0 → string.IsNullOrEmpty(s).\n"
            "8. PFC services → .NET dependency injection.\n"
            "9. 1-based PB indexes: document any shift to 0-based in C#."
        ),
    },
    "cobol": {
        "description": "COBOL business logic (ANSI-85 / Enterprise COBOL)",
        "common_patterns": [
            "PERFORM paragraphs and PERFORM UNTIL loops",
            "WORKING-STORAGE SECTION variables",
            "FILE-CONTROL and sequential/indexed I/O",
            "COMPUTE statements for arithmetic",
            "MOVE CORRESPONDING for record mapping",
            "REDEFINES clauses for memory overlays",
            "COPY books for shared data structures",
            "CALL to external programs (sub-programs)",
        ],
        "migration_notes": (
            "Map PIC clauses to appropriate .NET types (PIC 9 → int/decimal, "
            "PIC X → string). Replace FILE I/O with StreamReader/StreamWriter or "
            "database access. PERFORM paragraphs → private methods. "
            "Preserve fixed-point arithmetic precision using decimal, not double."
        ),
    },
    "vb6": {
        "description": "Visual Basic 6 / VBA",
        "common_patterns": [
            "Form events (Form_Load, Click, Change)",
            "ADO/DAO recordset operations",
            "On Error GoTo error handling",
            "Variant type usage",
            "COM object instantiation (CreateObject)",
            "Module-level global variables",
        ],
        "migration_notes": (
            "Replace Variant with strongly-typed generics. Map On Error GoTo to "
            "try/catch. Replace ADO recordsets with Entity Framework or Dapper. "
            "COM interop may require P/Invoke or managed wrappers in .NET."
        ),
    },
}


def get_language_context(language: str) -> str:
    """
    Return a rich context string for the given source language.
    Used by agents to prime their prompts with migration-specific knowledge.
    """
    hints = LANGUAGE_HINTS.get(language.lower(), {})
    if not hints:
        return f"Source language: {language}. Apply general migration best practices."

    patterns = "\n".join(f"  - {p}" for p in hints.get("common_patterns", []))
    notes = hints.get("migration_notes", "")

    return (
        f"Language: {hints.get('description', language)}\n\n"
        f"Key constructs to recognise:\n{patterns}\n\n"
        f"Migration strategy:\n{notes}"
    )
