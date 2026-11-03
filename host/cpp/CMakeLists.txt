cmake_minimum_required(VERSION 3.20)
project(imuninn_cpp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# protobuf (brew install protobuf). Generated sources come from tools/gen-proto.sh.
find_package(protobuf CONFIG REQUIRED)
find_package(absl CONFIG REQUIRED)

set(GEN_DIR ${CMAKE_CURRENT_SOURCE_DIR}/gen)
if(NOT EXISTS ${GEN_DIR}/imuninn.pb.cc)
  message(FATAL_ERROR "gen/imuninn.pb.cc missing: run tools/gen-proto.sh first")
endif()

add_library(imuninn STATIC
  src/client.cpp
  ${GEN_DIR}/imuninn.pb.cc
)
target_include_directories(imuninn PUBLIC include ${GEN_DIR})
target_link_libraries(imuninn PUBLIC protobuf::libprotobuf absl::log_internal_check_op absl::log_internal_message)
find_package(Threads REQUIRED)
target_link_libraries(imuninn PUBLIC Threads::Threads)

add_executable(imuninn_watch examples/watch.cpp)
target_link_libraries(imuninn_watch PRIVATE imuninn)
