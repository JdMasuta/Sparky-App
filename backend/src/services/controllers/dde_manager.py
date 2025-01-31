# simplified_dde_bridge.py
import sys
import json
import win32ui
import dde
import time

def check_dde_server(server_name, topic):
    """Quick check if DDE server is available"""
    server = None
    conversation = None
    try:
        server = dde.CreateServer()
        server.Create("DDETest")
        conversation = dde.CreateConversation(server)
        conversation.ConnectTo(server_name, topic)
        return True, "Connected successfully"
    except Exception as e:
        return False, str(e)
    finally:
        try:
            if conversation:
                del conversation
            if server:
                server.Destroy()
        except:
            pass

def create_dde_connection(server_name, topic):
    """Create and return DDE server and conversation"""
    server = dde.CreateServer()
    server.Create("DDEClient")
    conversation = dde.CreateConversation(server)
    conversation.ConnectTo(server_name, topic)
    return server, conversation

def handle_dde_command(command):
    """Handle different DDE commands"""
    try:
        server_name = command.get('application', 'RSLinx')
        topic = command.get('topic', 'ExcelLink')
        action = command.get('action')

        if action == 'check':
            available, message = check_dde_server(server_name, topic)
            return {
                'available': available,
                'message': message
            }

        # For read and write actions, create a connection
        server = None
        conversation = None
        try:
            server, conversation = create_dde_connection(server_name, topic)

            if action == 'read':
                value = conversation.Request(command['item'])
                return {
                    'value': value,
                    'error': None
                }

            elif action == 'write':
                conversation.Poke(command['item'], str(command['value']))
                return {
                    'success': True,
                    'error': None
                }

            else:
                return {
                    'error': f'Unknown action: {action}'
                }

        finally:
            try:
                if conversation:
                    del conversation
                if server:
                    server.Destroy()
            except:
                pass

    except Exception as e:
        return {
            'error': str(e)
        }

def main():
    """Main entry point for the DDE bridge"""
    try:
        if len(sys.argv) != 2:
            raise ValueError("Expected exactly one JSON argument")

        command = json.loads(sys.argv[1])
        result = handle_dde_command(command)
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({
            'error': str(e)
        }))
        sys.exit(1)

if __name__ == '__main__':
    main()