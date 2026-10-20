"""Solar Portfolio Memory worker.

Reads originals from the object store, parses and chunks them, asks Claude to propose entities,
claims and case matches, and submits the results to memory-api through the shared contract. The
API applies the auto-accept rule and appends events; this package holds no database connection.
"""
