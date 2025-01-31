import sys
import json
import win32ui
import dde
import time

def check_dde_server(server_name, topic):
    """
    Attempt to verify DDE server availability and provide diagnostic information.
    """
    try:
        # Create a temporary server for testing
        test_server = dde.CreateServer()
        test_server.Create("DDETest", dde.CBF_FAIL_EXECUTES | dde.CBF_FAIL_ADVISES)
        
        # Create a conversation for testing
        test_conv = dde.CreateConversation(test_server)
        
        # Try to connect with a timeout
        start_time = time.time()
        timeout = 5  # seconds
        last_error = None
        
        while time.time() - start_time < timeout:
            try:
                test_conv.ConnectTo(server_name, topic)
                return True, "Connection successful"
            except dde.error as e:
                last_error = str(e)
                time.sleep(0.5)
        
        error_info = {
            "attempted_server": server_name,
            "attempted_topic": topic,
            "last_error": last_error,
            "timeout": timeout
        }
        return False, json.dumps(error_info)
        
    except Exception as e:
        return False, f"Server check failed: {str(e)}"
    finally:
        try:
            if 'test_conv' in locals():
                del test_conv
            if 'test_server' in locals():
                test_server.Destroy()
        except:
            pass

def read_dde_value(parsed_link):
    """
    Read a value from DDE using the parsed link components.
    
    Args:
        parsed_link (dict): Dictionary containing DDE link components
            {
                'application': 'RSLinx',    # DDE server name
                'topic': 'ExcelLink',       # Topic name
                'item': '_200_GLB.DintData[2]',  # The actual tag to read
                'row': 'L1',               # Not used for RSLinx
                'column': 'C1'             # Not used for RSLinx
            }
    """
    server = None
    conversation = None
    
    try:
        # First check if the DDE server is available
        server_available, diagnostic_info = check_dde_server(
            parsed_link['application'], 
            parsed_link['topic']
        )
        
        if not server_available:
            return {
                'value': None,
                'error': f"DDE Server not available: {diagnostic_info}"
            }
        
        # Initialize win32ui
        win32ui.GetApp()
        
        # Create DDE server
        server = dde.CreateServer()
        server.Create("DDEClient", dde.CBF_FAIL_EXECUTES | dde.CBF_FAIL_ADVISES)
        
        # Create a DDE conversation using the server
        conversation = dde.CreateConversation(server)
        
        # Connect to RSLinx with retries
        max_retries = 3
        for attempt in range(max_retries):
            try:
                conversation.ConnectTo(parsed_link['application'], parsed_link['topic'])
                break
            except dde.error as e:
                if attempt == max_retries - 1:
                    raise
                time.sleep(1)
        
        # For RSLinx, we just use the item/tag directly
        value = conversation.Request(parsed_link['item'])
        
        return {
            'value': value,
            'error': None
        }
        
    except dde.error as e:
        return {
            'value': None,
            'error': f"DDE Error: {str(e)}\nServer: {parsed_link['application']}\nTopic: {parsed_link['topic']}\nItem: {parsed_link['item']}"
        }
    except Exception as e:
        return {
            'value': None,
            'error': f"Unexpected error: {str(e)}"
        }
    finally:
        try:
            if conversation:
                del conversation
            if server:
                server.Destroy()
        except:
            pass

def main():
    """Main entry point for the DDE bridge script."""
    try:
        # Check if we received a tag name argument
        if len(sys.argv) != 2:
            raise ValueError("Expected exactly one argument with the DDE link information")
        
        # Parse the input JSON
        parsed_link = json.loads(sys.argv[1])
        
        # Validate required fields
        required_fields = ['application', 'topic', 'item']
        for field in required_fields:
            if field not in parsed_link:
                raise ValueError(f"Missing required field: {field}")
        
        # Read the value
        result = read_dde_value(parsed_link)
        
        # Output the result as JSON
        print(json.dumps(result))
        
    except Exception as e:
        # If any error occurs, return it as JSON
        error_result = {
            'value': None,
            'error': str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == '__main__':
    main()