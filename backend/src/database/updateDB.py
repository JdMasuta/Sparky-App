import sqlite3
import sys
import os
import argparse

def get_confirmation(message):
    while True:
        response = input(f"{message} (yes/no): ").lower().strip()
        if response in ['yes', 'y']:
            return True
        elif response in ['no', 'n']:
            return False
        print("Please answer 'yes' or 'no'.")

def main():
    # Set up argument parser
    parser = argparse.ArgumentParser(description='SQLite table modifier for adding constraints and default values')
    
    # Add arguments
    parser.add_argument('-d', '--destination', metavar='<filepath>', help='Path to the SQLite database file')
    parser.add_argument('-i', '--info', action='store_true', help='Display schema information only (no changes made)')
    parser.add_argument('-t', '--table', metavar='<table name>', default='projects', help='Table name to modify (default: projects)')
    parser.add_argument('-c', '--column', metavar='<column name>', default='Status', help='Column name to modify (default: Status)')
    parser.add_argument('-v', '--values', metavar='<values>', default='ACTIVE,INACTIVE', help='Comma-separated list of allowed values (default: ACTIVE,INACTIVE)')
    parser.add_argument('-f', '--default', metavar='<default value>', default='ACTIVE', help='Default value for the column (default: ACTIVE)')
    parser.add_argument('--ignore-case', action='store_true', help='Make column check case-insensitive')
    parser.add_argument('-n', '--null-value', metavar='<null substitution>', help='Value to substitute for NULL values during copy (if different from default)')
    parser.add_argument('-g', '--nonconforming-value', metavar='<value>', help='Value to map nonconforming values to (skips interactive prompt)')
    parser.add_argument('-s', '--sample-limit', type=int, default=3, help='Number of sample rows to display for each nonconforming value (default: 3)')
    
    # Parse arguments
    args = parser.parse_args()
    
    # If null_value is not provided, use the default value
    if args.null_value is None:
        args.null_value = args.default
    
    # Check if destination is provided
    if not args.destination:
        parser.print_help()
        sys.exit(1)
    
    # Check if database file exists
    if not os.path.exists(args.destination):
        print(f"Error: Database file '{args.destination}' does not exist.")
        sys.exit(1)
    
    # Connect to database
    try:
        conn = sqlite3.connect(args.destination)
        cursor = conn.cursor()
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)
    
    # Flag to track if we created a new table that needs cleanup
    new_table_created = False
    
    try:
        # Check if table exists
        cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{args.table}'")
        if not cursor.fetchone():
            print(f"Error: '{args.table}' table does not exist in this database.")
            conn.close()
            sys.exit(1)
        
        # Get table structure
        cursor.execute(f"PRAGMA table_info({args.table})")
        columns = cursor.fetchall()
        
        # Check if specified column exists
        column_exists = False
        for col in columns:
            if col[1].lower() == args.column.lower():
                args.column = col[1]  # Use the actual column name with correct case
                column_exists = True
                break
                    
        if not column_exists:
            print(f"Error: '{args.column}' column does not exist in the '{args.table}' table.")
            conn.close()
            sys.exit(1)
        
        # Print current table structure
        print(f"\nTable structure for '{args.table}':")
        print("-" * 80)
        print(f"{'ID':<3} | {'Name':<20} | {'Type':<10} | {'NotNull':<7} | {'Default':<20} | {'PK':<2}")
        print("-" * 80)
        for col in columns:
            print(f"{col[0]:<3} | {col[1]:<20} | {col[2]:<10} | {col[3]:<7} | {str(col[4]):<20} | {col[5]:<2}")
        
        # If info flag is provided, exit after displaying information
        if args.info:
            conn.close()
            print("\nInformation mode: No changes made to the database.")
            sys.exit(0)
        
        # Check current values in the column
        cursor.execute(f"SELECT DISTINCT {args.column} FROM {args.table} WHERE {args.column} IS NOT NULL")
        existing_values = [row[0] for row in cursor.fetchall() if row[0] is not None]
        
        # Prepare allowed values 
        allowed_values = [val.strip() for val in args.values.split(',')]
        allowed_values_lower = [val.lower() for val in allowed_values]
        
        # Create a mapping dictionary for case correction
        case_mapping = {}
        truly_non_conforming = []
        
        for val in existing_values:
            if val in allowed_values:
                # Value matches exactly - no mapping needed
                continue
            elif val.lower() in allowed_values_lower:
                # Value matches when ignoring case - map to correct case
                correct_index = allowed_values_lower.index(val.lower())
                correct_value = allowed_values[correct_index]
                case_mapping[val] = correct_value
                print(f"Found incorrect case: '{val}' will be fixed to '{correct_value}'")
            else:
                # Value doesn't match even when ignoring case
                truly_non_conforming.append(val)
        
        # Handle truly non-conforming values
        if truly_non_conforming:
            print("\nWARNING: The following values currently exist in the column but are not in your allowed values list:")
            
            # Collect information about nonconforming values
            nonconforming_info = {}
            for val in truly_non_conforming:
                # Get count of rows with this value
                cursor.execute(f"SELECT COUNT(*) FROM {args.table} WHERE {args.column} = ?", (val,))
                count = cursor.fetchone()[0]
                
                # Get sample rows with this value
                cursor.execute(f"SELECT * FROM {args.table} WHERE {args.column} = ? LIMIT {args.sample_limit}", (val,))
                sample_rows = cursor.fetchall()
                
                # Store information
                nonconforming_info[val] = {
                    'count': count,
                    'sample_rows': sample_rows
                }
                
                # Display information about this nonconforming value
                print(f"\n  - '{val}' (found in {count} rows)")
                
                if sample_rows:
                    print("    Sample entries:")
                    # Get column names for better display
                    column_names = [col[1] for col in columns]
                    
                    # Display each sample row
                    for i, row in enumerate(sample_rows, 1):
                        print(f"    Sample {i}:")
                        for col_idx, col_value in enumerate(row):
                            print(f"      {column_names[col_idx]}: {col_value}")
            
            # Check if nonconforming-value flag was provided
            if args.nonconforming_value is not None:
                # Validate that the provided value is in the allowed values list
                if args.nonconforming_value not in allowed_values:
                    print(f"Adding nonconforming value '{args.nonconforming_value}' to allowed values list")
                    allowed_values.append(args.nonconforming_value)
                
                print(f"Using '{args.nonconforming_value}' for all nonconforming values (from --nonconforming-value flag)")
                for val in truly_non_conforming:
                    case_mapping[val] = args.nonconforming_value
            else:
                # Interactive mode
                print("\nOptions to handle non-conforming values:")
                print("1. Map them all to the default value")
                print("2. Add them all to the allowed values list")
                print("3. Specify a custom value to map them all to")
                print("4. Handle each non-conforming value individually")
                print("5. Cancel the operation")
                
                while True:
                    choice = input("\nChoose an option (1/2/3/4/5): ").strip()
                    if choice == '1':
                        print(f"All non-conforming values will be mapped to '{args.default}'")
                        for val in truly_non_conforming:
                            case_mapping[val] = args.default
                        break
                    elif choice == '2':
                        allowed_values.extend(truly_non_conforming)
                        print(f"Allowed values list expanded to: {', '.join(allowed_values)}")
                        break
                    elif choice == '3':
                        custom_value = input("\nEnter the custom value to map all non-conforming values to: ").strip()
                        # Validate that the custom value is in the allowed values list
                        if custom_value not in allowed_values:
                            if not get_confirmation(f"WARNING: '{custom_value}' is not in the allowed values list. Add it?"):
                                print("Please choose another option.")
                                continue
                            allowed_values.append(custom_value)
                            print(f"Allowed values list expanded to include: {', '.join(allowed_values)}")
                        
                        print(f"All non-conforming values will be mapped to '{custom_value}'")
                        for val in truly_non_conforming:
                            case_mapping[val] = custom_value
                        break
                    elif choice == '4':
                        # Handle each non-conforming value individually
                        for val in truly_non_conforming:
                            count = nonconforming_info[val]['count']
                            print(f"\nHandling non-conforming value: '{val}' (found in {count} rows)")
                            
                            print("Options:")
                            print(f"1. Map to default value ('{args.default}')")
                            print("2. Add to allowed values list")
                            print("3. Specify a custom value")
                            
                            while True:
                                individual_choice = input("Choose an option (1/2/3): ").strip()
                                if individual_choice == '1':
                                    print(f"Mapping '{val}' to '{args.default}'")
                                    case_mapping[val] = args.default
                                    break
                                elif individual_choice == '2':
                                    allowed_values.append(val)
                                    print(f"Added '{val}' to allowed values list")
                                    break
                                elif individual_choice == '3':
                                    custom_val = input(f"Enter value to map '{val}' to: ").strip()
                                    if custom_val not in allowed_values:
                                        if not get_confirmation(f"WARNING: '{custom_val}' is not in the allowed values list. Add it?"):
                                            print("Please choose another option.")
                                            continue
                                        allowed_values.append(custom_val)
                                        print(f"Added '{custom_val}' to allowed values list")
                                    case_mapping[val] = custom_val
                                    print(f"Mapping '{val}' to '{custom_val}'")
                                    break
                                else:
                                    print("Invalid choice. Please enter 1, 2, or 3.")
                        break
                    elif choice == '5':
                        print("Operation cancelled.")
                        conn.close()
                        sys.exit(0)
                    else:
                        print("Invalid choice. Please enter 1, 2, 3, 4, or 5.")
        
        # CONFIRMATION POINT 1: After showing table info and handling non-conforming values
        if not get_confirmation("\nContinue with modifying this table?"):
            print("Operation cancelled.")
            conn.close()
            sys.exit(0)
        
        # Create backup
        backup_path = f"{args.destination}.backup"
        try:
            with open(args.destination, 'rb') as src, open(backup_path, 'wb') as dst:
                dst.write(src.read())
            print(f"Database backup created at: {backup_path}")
        except Exception as e:
            print(f"Warning: Failed to create backup: {e}")
            if not get_confirmation("Continue without backup?"):
                print("Operation cancelled.")
                conn.close()
                sys.exit(0)
        
        # Prepare the CHECK constraint
        check_values_str = "', '".join(allowed_values)
        check_constraint = f"CHECK ({args.column} IN ('{check_values_str}'))"
        
        if args.ignore_case:
            # For case-insensitive check, we need a different approach
            # We'll use the UPPER function in the check constraint
            upper_values = [val.upper() for val in allowed_values]
            check_values_str = "', '".join(upper_values)
            check_constraint = f"CHECK (UPPER({args.column}) IN ('{check_values_str}'))"
        
        # Build the create table SQL statement
        create_table_sql = f"CREATE TABLE {args.table}_new ("
        column_defs = []
        
        for col in columns:
            col_id, col_name, col_type, col_notnull, col_default, col_pk = col
            
            if col_name == args.column:
                column_defs.append(f"{args.column} TEXT DEFAULT '{args.default}' {check_constraint}")
            else:
                col_def = f"{col_name} {col_type}"
                if col_notnull:
                    col_def += " NOT NULL"
                if col_default is not None:
                    col_def += f" DEFAULT {col_default}"
                if col_pk:
                    col_def += " PRIMARY KEY"
                column_defs.append(col_def)
        
        create_table_sql += ", ".join(column_defs) + ")"
        
        # Show the SQL that will be executed for creating the new table
        print("\nSQL for creating the new table:")
        print("-" * 80)
        print(create_table_sql)
        
        # CONFIRMATION POINT 2: Before creating the new table
        if not get_confirmation("\nCreate new table with these specifications?"):
            print("Operation cancelled.")
            conn.close()
            sys.exit(0)
        
        # Create new table
        cursor.execute(create_table_sql)
        new_table_created = True
        print(f"Created new table '{args.table}_new'")
        
        # Prepare SQL for copying data with case correction
        if case_mapping:
            # If we have mappings to correct, we need to use a CASE statement
            select_columns = []
            for col in columns:
                col_name = col[1]
                if col_name == args.column and case_mapping:
                    case_stmt = f"CASE {args.column} "
                    for old_val, new_val in case_mapping.items():
                        case_stmt += f"WHEN '{old_val}' THEN '{new_val}' "
                    case_stmt += f"ELSE {args.column} END"
                    select_columns.append(case_stmt)
                else:
                    select_columns.append(col_name)
            
            select_sql = ", ".join(select_columns)
            insert_sql = f"INSERT INTO {args.table}_new SELECT {select_sql} FROM {args.table}"
        else:
            # No mappings needed, simple copy
            insert_sql = f"INSERT INTO {args.table}_new SELECT * FROM {args.table}"
        
        # Show SQL for copying data
        print(f"\nSQL for copying data: {insert_sql}")
        
        # CONFIRMATION POINT 3: Before copying data
        if not get_confirmation("Copy data to the new table?"):
            # Clean up the new table before exiting
            cursor.execute(f"DROP TABLE {args.table}_new")
            new_table_created = False
            print(f"Dropped table '{args.table}_new'. Operation cancelled.")
            conn.close()
            sys.exit(0)
        
        # Copy data
        cursor.execute(insert_sql)
        rows_copied = cursor.rowcount if cursor.rowcount >= 0 else "all"
        print(f"Copied {rows_copied} rows to the new table")
        
        # Show SQL for updating NULL values with the new null_value parameter
        print(f"\nSQL for updating NULL values: UPDATE {args.table}_new SET {args.column} = '{args.null_value}' WHERE {args.column} IS NULL")
        
        # CONFIRMATION POINT 4: Before updating NULL values
        if not get_confirmation("Update NULL values to the specified null substitution value?"):
            # Clean up the new table before exiting
            cursor.execute(f"DROP TABLE {args.table}_new")
            new_table_created = False
            print(f"Dropped table '{args.table}_new'. Operation cancelled.")
            conn.close()
            sys.exit(0)
        
        # Update NULL values
        cursor.execute(f"UPDATE {args.table}_new SET {args.column} = '{args.null_value}' WHERE {args.column} IS NULL")
        rows_updated = cursor.rowcount
        print(f"Updated {rows_updated} NULL {args.column} values to '{args.null_value}'")
        
        # Show SQL for dropping the original table
        print(f"\nSQL for dropping original table: DROP TABLE {args.table}")
        
        # CONFIRMATION POINT 5: Before dropping the original table
        if not get_confirmation("Drop the original table?"):
            # Clean up the new table before exiting
            cursor.execute(f"DROP TABLE {args.table}_new")
            new_table_created = False
            print(f"Dropped table '{args.table}_new'. Operation cancelled.")
            conn.close()
            sys.exit(0)
        
        # Drop old table
        cursor.execute(f"DROP TABLE {args.table}")
        print(f"Dropped original table '{args.table}'")
        
        # Show SQL for renaming the new table
        print(f"\nSQL for renaming table: ALTER TABLE {args.table}_new RENAME TO {args.table}")
        
        # CONFIRMATION POINT 6: Before renaming the new table
        if not get_confirmation("Rename the new table to the original name?"):
            print("Warning: Original table has been dropped but new table hasn't been renamed.")
            print(f"You can access your data in the '{args.table}_new' table.")
            conn.commit()
            conn.close()
            sys.exit(0)
        
        # Rename new table
        cursor.execute(f"ALTER TABLE {args.table}_new RENAME TO {args.table}")
        new_table_created = False  # No longer need cleanup since we renamed
        print(f"Renamed new table to '{args.table}'")
        
        # Commit changes
        conn.commit()
        print("Changes committed successfully")
        
    except Exception as e:
        # Roll back transaction
        conn.rollback()
        
        # Clean up the new table if it was created but not renamed
        if new_table_created:
            try:
                cursor.execute(f"DROP TABLE IF EXISTS {args.table}_new")
                print(f"Cleaned up: Dropped table '{args.table}_new'")
            except:
                print(f"Warning: Could not clean up temporary table '{args.table}_new'")
        
        print(f"Error occurred: {e}")
        print("Changes rolled back. Database is unchanged.")
    finally:
        # Verify the final table structure
        try:
            cursor.execute(f"PRAGMA table_info({args.table})")
            new_columns = cursor.fetchall()
            print("\nFinal table structure:")
            print("-" * 80)
            print(f"{'ID':<3} | {'Name':<20} | {'Type':<10} | {'NotNull':<7} | {'Default':<20} | {'PK':<2}")
            print("-" * 80)
            for col in new_columns:
                print(f"{col[0]:<3} | {col[1]:<20} | {col[2]:<10} | {col[3]:<7} | {str(col[4]):<20} | {col[5]:<2}")
        except Exception as e:
            print(f"Error displaying final structure: {e}")
        
        # Close connection
        conn.close()
        print("\nDatabase connection closed.")

if __name__ == "__main__":
    main()