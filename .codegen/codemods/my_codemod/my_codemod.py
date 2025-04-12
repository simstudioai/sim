import codegen
from codegen.sdk.core.codebase import Codebase

@codegen.function("my-codemod")
def run(codebase: Codebase):
    """Visualize the codebase structure showing functions, classes, and their relationships."""
    try:
        print('\n=== Codebase Analysis ===')
        print(f'Total files: {len(codebase.files)}')
        print(f'Total functions: {len(codebase.functions)}')
        print(f'Total classes: {len(codebase.classes)}')
        print(f'Total imports: {len(codebase.imports)}')
        
        print('\n=== Functions ===')
        for function in codebase.functions:
            print(f'\nFunction: {function.name}')
            # Check for different types of function attributes
            if hasattr(function, 'calls'):
                if function.calls:
                    print('  Calls:')
                    for called_function in function.calls:
                        print(f'    - {called_function.name}')
            elif hasattr(function, 'references'):
                if function.references:
                    print('  References:')
                    for ref in function.references:
                        print(f'    - {ref}')
            elif hasattr(function, 'usages'):
                if function.usages:
                    print('  Usages:')
                    for usage in function.usages:
                        print(f'    - {usage}')
        
        print('\n=== Classes ===')
        for class_def in codebase.classes:
            print(f'\nClass: {class_def.name}')
            if hasattr(class_def, 'parents'):
                if class_def.parents:
                    print('  Inherits from:')
                    for parent in class_def.parents:
                        print(f'    - {parent.name}')
            if hasattr(class_def, 'methods'):
                if class_def.methods:
                    print('  Methods:')
                    for method in class_def.methods:
                        print(f'    - {method.name}')
        
        print('\n=== Imports ===')
        for imp in codebase.imports:
            print(f'- {imp}')
            
    except Exception as e:
        print(f"Error in visualization: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    try:
        print('Parsing codebase...')
        codebase = Codebase("./")
        
        print('Running visualization...')
        run(codebase)
    except Exception as e:
        print(f"Error in main: {str(e)}")
        import traceback
        traceback.print_exc() 