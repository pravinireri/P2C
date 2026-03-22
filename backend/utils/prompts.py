"""
Prompt templates and context utilities.
Extended with deep PowerBuilder migration intelligence.
"""

# Language-specific migration context for better LLM output
LANGUAGE_HINTS = {
    "powerbuilder": {
        "description": "PowerBuilder / PowerScript with DataWindow technology",
        "common_patterns": [
            "DataWindow operations: Retrieve(), Update(), InsertRow(), DeleteRow()",
            "DataStore (non-visual DataWindow equivalent)",
            "Global and instance variables (g_, i_ prefixes)",
            "Events: Clicked, Open, Close, Constructor, Destructor",
            "Embedded SQL: CONNECT, SELECT, INSERT, UPDATE, DECLARE CURSOR",
            "PowerBuilder Foundation Classes (PFC) service architecture",
            "Transaction objects (SQLCA) for database connectivity",
            "PBNI (PowerBuilder Native Interface) for external DLL calls",
            "Message object for inter-window communication",
            "Application, Window, Menu, UserObject inheritance hierarchy",
        ],
        "migration_notes": (
            "When migrating DataWindows, replace with Entity Framework Core or "
            "Dapper with LINQ queries. Map SQLCA transactions to IDbConnection / "
            "SqlConnection. PowerScript's string concatenation (+) maps to C# "
            "interpolation. Replace messagebox() with structured logging or exceptions. "
            "Map PFC services to .NET dependency injection."
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

    patterns = "\n".join(f"  • {p}" for p in hints.get("common_patterns", []))
    notes = hints.get("migration_notes", "")

    return (
        f"Language: {hints.get('description', language)}\n\n"
        f"Key constructs to recognise:\n{patterns}\n\n"
        f"Migration strategy: {notes}"
    )
