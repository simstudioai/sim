import codegen
from codegen.sdk.core.codebase import Codebase

@codegen.function("add-types")
def run(codebase: Codebase):
    """Add TypeScript types to function parameters and return types."""
    try:
        print('\n=== Adding TypeScript Types ===')
        
        # Track changes made
        changes_made = 0
        
        # Process each TypeScript/JavaScript file
        for file in codebase.files:
            # Convert PosixPath to string for endswith check
            file_path = str(file.path)
            if not (file_path.endswith('.ts') or file_path.endswith('.tsx')):
                continue
                
            print(f'\nProcessing file: {file_path}')
            
            # Process each function in the file
            for function in file.functions:
                try:
                    # Skip if function is a React component (starts with capital letter)
                    if function.name[0].isupper():
                        continue

                    # Get the function's source code
                    source = function.source
                    if not source:
                        continue

                    # Skip if function already has type annotations
                    if '):' in source or source.strip().startswith('function*'):
                        continue

                    # Get function parameters
                    params = function.parameters if hasattr(function, 'parameters') else []
                    
                    # Build the parameter types
                    param_types = []
                    for param in params:
                        param_name = param.name
                        # Infer type based on usage
                        if param_name.startswith('is') or param_name.startswith('has'):
                            param_type = 'boolean'
                        elif 'count' in param_name or 'index' in param_name:
                            param_type = 'number'
                        elif 'text' in param_name or 'message' in param_name:
                            param_type = 'string'
                        else:
                            param_type = 'any'
                        param_types.append(f"{param_name}: {param_type}")

                    # Determine return type
                    if function.name.startswith('get'):
                        return_type = 'any'
                    elif function.name.startswith('is') or function.name.startswith('has'):
                        return_type = 'boolean'
                    elif function.name.startswith('set'):
                        return_type = 'void'
                    else:
                        return_type = 'any'

                    # Find the function declaration
                    if 'function' in source:
                        # Regular function declaration
                        old_params_start = source.find('(')
                        old_params_end = source.find(')')
                        if old_params_start == -1 or old_params_end == -1:
                            continue

                        # Create new function declaration
                        new_source = (
                            source[:old_params_start + 1] +
                            ', '.join(param_types) +
                            source[old_params_end:old_params_end + 1] +
                            ': ' + return_type +
                            source[old_params_end + 1:]
                        )
                    else:
                        # Arrow function
                        arrow_idx = source.find('=>')
                        if arrow_idx == -1:
                            continue

                        # Find parameter list
                        old_params_start = source.rfind('(', 0, arrow_idx)
                        old_params_end = source.find(')', old_params_start)
                        if old_params_start == -1 or old_params_end == -1:
                            continue

                        # Create new arrow function
                        new_source = (
                            source[:old_params_start + 1] +
                            ', '.join(param_types) +
                            source[old_params_end:old_params_end + 1] +
                            ': ' + return_type +
                            source[old_params_end + 1:]
                        )

                    # Apply the changes using the edit method
                    function.edit(new_source)
                    changes_made += 1
                    print(f"  Added types to function: {function.name}")
                    
                except Exception as e:
                    print(f"  Error processing function {function.name}: {str(e)}")
                    continue
        
        # Commit all changes at once
        if changes_made > 0:
            codebase.commit()
            print("\nAll changes have been committed.")
        
        print(f'\n=== Summary ===')
        print(f'Total changes made: {changes_made}')
            
    except Exception as e:
        print(f"Error in codemod: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    try:
        print('Parsing codebase...')
        codebase = Codebase("./")
        
        print('Running type addition...')
        run(codebase)
    except Exception as e:
        print(f"Error in main: {str(e)}")
        import traceback
        traceback.print_exc() 