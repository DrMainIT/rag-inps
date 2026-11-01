import chainlit as cl
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from agent import graph


@cl.on_message
async def on_message(msg: cl.Message):
    config = {"configurable": {"thread_id": cl.context.session.id}}
    cb = cl.LangchainCallbackHandler()
    final_answer = cl.Message(content="")
    
    for message, metadata in graph.stream(
        {"messages": [HumanMessage(content=msg.content)]}, 
        stream_mode="messages", 
        config=RunnableConfig(callbacks=[cb], **config)
    ):
        # Only display AI messages (not tool messages or tool calls)
        if isinstance(message, AIMessage) and message.content and not message.tool_calls:
            await final_answer.stream_token(message.content)

    await final_answer.send()
