import win32ui
import dde
import time
import json
from typing import Dict, Any, Tuple


def check_server_available(server_name: str, topic: str) -> Tuple[bool, str]:
    """
    Check DDE server availability with timeout and retry logic.
    
    Args:
        server_name (str): Name of the DDE server (e.g., "RSLinx")
        topic (str): Topic name (e.g., "ExcelLink")
    
    Returns:
        Tuple[bool, str]: (success status, diagnostic message)
    """
    test_server = None
    test_conv = None
    try:
        test_server = dde.CreateServer()
        test_server.Create("DDETest", dde.CBF_FAIL_EXECUTES | dde.CBF_FAIL_ADVISES)
        test_conv = dde.CreateConversation(test_server)
        
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
            if test_conv:
                del test_conv
            if test_server:
                test_server.Destroy()
        except:
            pass

def initialize_dde_connection(server_name: str, topic: str, max_retries: int = 3, retry_delay: float = 1.0) -> Tuple[dde.Server, dde.Connection, str]:
    """
    Initialize a DDE connection with retry logic.
    
    Args:
        server_name (str): Name of the DDE server (e.g., "RSLinx")
        topic (str): Topic name (e.g., "ExcelLink")
        max_retries (int): Maximum number of connection attempts
        retry_delay (float): Delay between retries in seconds
    
    Returns:
        Tuple[dde.Server, dde.Connection, str]: (DDE server instance, DDE conversation instance, error message)
        If connection fails, returns (None, None, error_message)
    """
    server = None
    conversation = None

    try:
        # Check server availability first
        server_available, diagnostic_info = check_server_available(server_name, topic)
        if not server_available:
            return None, None, f"DDE Server not available: {diagnostic_info}"

        # Initialize win32ui
        win32ui.GetApp()
        
        # Create DDE server
        server = dde.CreateServer()
        server.Create("DDEClient", dde.CBF_FAIL_EXECUTES | dde.CBF_FAIL_ADVISES)
        
        # Create conversation
        conversation = dde.CreateConversation(server)
        
        # Connect with retries
        last_error = None
        for attempt in range(max_retries):
            try:
                conversation.ConnectTo(server_name, topic)
                return server, conversation, ""
            except dde.error as e:
                last_error = str(e)
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                    continue
                else:
                    cleanup_dde_resources(server, conversation)
                    return None, None, f"Failed to connect after {max_retries} attempts. Last error: {last_error}"
                
    except Exception as e:
        cleanup_dde_resources(server, conversation)
        return None, None, str(e)

def cleanup_dde_resources(server: dde.Server = None, conversation: dde.Connection = None) -> None:
    """
    Clean up DDE resources safely.
    
    Args:
        server (dde.Server): DDE server instance to cleanup
        conversation (dde.Connection): DDE conversation instance to cleanup
    """
    try:
        if conversation:
            del conversation
        if server:
            server.Destroy()
    except:
        pass

def validate_connection(conversation: dde.Connection, test_tag: str) -> Tuple[bool, str]:
    """
    Validate an existing DDE connection by attempting to read a test tag.
    
    Args:
        conversation (dde.Connection): Existing DDE conversation to validate
        test_tag (str): Tag to test read from
    
    Returns:
        Tuple[bool, str]: (success status, error message if any)
    """
    try:
        _ = conversation.Request(test_tag)
        return True, ""
    except Exception as e:
        return False, str(e)