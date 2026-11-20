# Release builds run R8. These libraries look classes and members up by name at run time,
# so their names must survive (consumer rules: applied to the app that includes this module).

# protobuf-java (full runtime): generated messages are read and written through reflection
# on their accessors and fields.
-keep class io.imuninn.proto.** { *; }
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**

# Java-WebSocket: the control server.
-keep class org.java_websocket.** { *; }
-dontwarn org.java_websocket.**
-dontwarn org.slf4j.**

# lz4-java: LZ4Factory loads its compressor classes by name.
-keep class net.jpountz.** { *; }
-dontwarn net.jpountz.**
